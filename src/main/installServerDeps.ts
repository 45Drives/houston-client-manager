import path from "path";
import { NodeSSH } from "node-ssh";
import { checkSSH, setupSshKey, runBootstrapScript, checkRemoteDeps, ensureHoustonPackages, type RemoteDepCheck, type SshAuth, type SshAuthMethod } from "./setupSsh";
import { assertSafeHost, assertSafeUsername } from "./security";
import { getAgentSocket, getKeyDir, ensureKeyPair } from "./crossPlatformSsh";
import { getHoustonPackage, houstonPackageLabel } from "../shared/serverPackages";


type ProgressFn = (p: { step: string; label: string }) => void;

/** e.g. "Task Scheduler 1.7.5 (needs 1.7.7)". */
function describeBelowMinimum(check: RemoteDepCheck): string {
    return check.houstonBelowMinimum
        .map((name) => {
            const min = getHoustonPackage(name)?.minVersion;
            return `${houstonPackageLabel(name)} ${check.houstonVersions[name]} (needs ${min})`;
        })
        .join(", ");
}

/**
 * Re-checks after an install. A package still below its minimum means the
 * server's repo cannot supply a new enough build, which no retry will fix.
 */
async function warnIfStillBelowMinimum(
    host: string,
    username: string,
    privateKeyPath: string,
    send: (step: string, label: string) => void,
) {
    try {
        const check = await checkRemoteDeps(host, username, privateKeyPath);
        if (check.houstonBelowMinimum.length === 0) return;
        send(
            "bootstrap-log",
            `[WARN] Still below the minimum supported version after updating: ${describeBelowMinimum(check)}. ` +
            `The 45Drives repository on this server may be stale or unavailable for its OS release.`,
        );
    } catch (e: any) {
        console.warn("Minimum-version re-check failed:", e?.message || e);
    }
}

export async function installServerDepsRemotely({
    host,
    username,
    password,
    authMethod,
    sshKeyPath,
    sshPassphrase,
    onProgress,
}: {
    host: string;
    username: string;
    password: string;
    authMethod?: SshAuthMethod;
    sshKeyPath?: string;
    sshPassphrase?: string;
    onProgress?: ProgressFn;
}) {
    const safeHost = assertSafeHost(host);
    const safeUser = assertSafeUsername(username);

    // Build SshAuth for the new helper
    const auth: SshAuth = {
        username: safeUser,
        method: authMethod || 'password',
        password,
        privateKeyPath: sshKeyPath,
        passphrase: sshPassphrase,
    };

    const send = (step: string, label: string) => {
        onProgress?.({ step, label });
        console.debug("installServerDepsRemotely.onProgress:", step, label);
    };

    try {
        send("probe", `Checking if ${safeHost}:22 is reachable…`);
        const reachable = await checkSSH(safeHost);

        if (!reachable) {
            const msg = `Host ${safeHost}:22 not reachable.`;
            send("error", msg);
            return { success: false, error: msg };
        }

        let hasAuth = false;
        const agentSock = getAgentSocket();
        if (agentSock) {
            send("auth", "Trying SSH agent…");
            const trial = new NodeSSH();
            try {
                await trial.connect({
                    host: safeHost,
                    username: safeUser,
                    agent: agentSock,
                    tryKeyboard: false,
                });
                hasAuth = true;
                send("auth", "SSH agent authentication succeeded.");
            } catch {
                send("auth", "SSH agent authentication failed; will fall back to password.");
            } finally {
                trial.dispose();
            }
        }

        if (!hasAuth) {
            send("key", "Generating SSH key and copying it to the server…");
            await setupSshKey(safeHost, safeUser, password, auth);
            send("key", "SSH key installed on server.");
        } else {
            send("key", "Reusing existing SSH key / agent credentials.");
        }

        const keyDir = getKeyDir();
        const privateKeyPath = path.join(keyDir, "id_rsa");
        const publicKeyPath = `${privateKeyPath}.pub`;

        send("key", "Ensuring local SSH keypair exists…");
        await ensureKeyPair(privateKeyPath, publicKeyPath);

        // probe for missing deps
        send("probe", "Checking for required dependencies (Cockpit, ZFS, Samba, 45Drives packages)…");
        try {
            const result = await checkRemoteDeps(safeHost, safeUser, privateKeyPath);

            if (
                result.missing.length === 0 &&
                result.houstonOutdated.length === 0 &&
                result.houstonBelowMinimum.length === 0
            ) {
                send("done", "All required dependencies are already installed and up to date. Skipping bootstrap.");
                return { success: true, reboot: false };
            }

            if (result.houstonBelowMinimum.length > 0) {
                send("packages", `Server modules below the minimum supported version: ${describeBelowMinimum(result)}.`);
            }

            if (result.baseMissing.length === 0) {
                // Base OS is fine — only 45Drives packages need installing or updating,
                // so skip the heavy bootstrap.
                const toInstall = [...new Set([
                    ...result.houstonMissing,
                    ...result.houstonOutdated,
                    ...result.houstonBelowMinimum,
                ])];
                send(
                    "packages",
                    result.houstonMissing.length
                        ? `Installing 45Drives packages: ${toInstall.join(", ")}…`
                        : `Updating 45Drives packages: ${toInstall.join(", ")}…`,
                );
                await ensureHoustonPackages(
                    safeHost,
                    safeUser,
                    privateKeyPath,
                    password,
                    toInstall,
                    (line, stream) => {
                        if (!line || line === password) return;
                        if (stream === "stderr" || /^\[(INFO|WARN|ERROR)/.test(line)) {
                            send("bootstrap-log", line);
                        }
                    },
                );
                await warnIfStillBelowMinimum(safeHost, safeUser, privateKeyPath, send);
                send("done", "45Drives packages are up to date.");
                return { success: true, reboot: false };
            }

            send("bootstrap", `Missing dependencies detected: ${result.missing.join(", ")}. Running bootstrap setup…`);
        } catch (e: any) {
            // if the check fails, be conservative and run bootstrap
            console.warn("Dependency preflight check failed; running bootstrap anyway:", e?.message || e);
            send("bootstrap", "Could not verify dependencies; running bootstrap setup anyway…");
        }

        send("bootstrap", "Running setup script on the server… this may take several minutes.");

        const rebootRequired = await runBootstrapScript(
            safeHost,
            safeUser,
            privateKeyPath,
            password,
            (line, stream) => {
                if (!line) return;

                // extra safety on the UI side too
                if (line === password) return;

                if (stream === "stderr") {
                    // always show stderr – this is where shell errors like "unbound variable" go
                    send("bootstrap-log", line);
                    return;
                }

                // stdout: keep your "tagged" lines, plus errors
                if (/^\[(INFO|WARN|ERROR|BOOTSTRAP)/.test(line)) {
                    send("bootstrap-log", line);
                }
            },
        );

        // Bootstrap sets up the repo and core packages; make sure the rest of the
        // 45Drives suite landed too (older bootstrap scripts only install a subset).
        try {
            const after = await checkRemoteDeps(safeHost, safeUser, privateKeyPath);
            const toInstall = [...new Set([
                ...after.houstonMissing,
                ...after.houstonOutdated,
                ...after.houstonBelowMinimum,
            ])];
            if (toInstall.length > 0) {
                send("packages", `Installing 45Drives packages: ${toInstall.join(", ")}…`);
                await ensureHoustonPackages(
                    safeHost,
                    safeUser,
                    privateKeyPath,
                    password,
                    toInstall,
                    (line, stream) => {
                        if (!line || line === password) return;
                        if (stream === "stderr" || /^\[(INFO|WARN|ERROR)/.test(line)) {
                            send("bootstrap-log", line);
                        }
                    },
                );
                await warnIfStillBelowMinimum(safeHost, safeUser, privateKeyPath, send);
            }
        } catch (e: any) {
            console.warn("Post-bootstrap 45Drives package check failed:", e?.message || e);
            send("bootstrap-log", `[WARN] Could not verify 45Drives packages: ${e?.message || e}`);
        }

        return { success: true, reboot: rebootRequired };
    } catch (err: any) {
        const msg = err?.message || String(err);
        send("error", `Installation failed: ${msg}`);
        console.error("SSH failure:", err?.message);
        return { success: false, error: msg };
    }
}

