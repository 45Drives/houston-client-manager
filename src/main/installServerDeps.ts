import path from "path";
import { NodeSSH } from "node-ssh";
import { checkSSH, setupSshKey, runBootstrapScript, checkRemoteDeps } from "./setupSsh";
import { getAgentSocket, getKeyDir, ensureKeyPair } from "./crossPlatformSsh";


type ProgressFn = (p: { step: string; label: string }) => void;
export async function installServerDepsRemotely({
    host,
    username,
    password,
    onProgress,
}: {
    host: string;
    username: string;
    password: string;
    onProgress?: ProgressFn;
}) {
    const send = (step: string, label: string) => {
        onProgress?.({ step, label });
        console.debug("installServerDepsRemotely.onProgress:", step, label);
    };

    try {
        send("probe", `Checking if ${host}:22 is reachable…`);
        const reachable = await checkSSH(host);

        if (!reachable) {
            const msg = `Host ${host}:22 not reachable.`;
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
                    host,
                    username,
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
            await setupSshKey(host, username, password);
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
        send("probe", "Checking for required dependencies (Cockpit, ZFS, Samba, cockpit-super-simple-setup)…");
        let missing: string[] = [];
        try {
            const result = await checkRemoteDeps(host, username, privateKeyPath);
            missing = result.missing;
            if (missing.length === 0) {
                send("done", "All required dependencies are already installed. Skipping bootstrap.");
                return { success: true, reboot: false };
            }
            send("bootstrap", `Missing dependencies detected: ${missing.join(", ")}. Running bootstrap setup…`);
        } catch (e: any) {
            // if the check fails, be conservative and run bootstrap
            console.warn("Dependency preflight check failed; running bootstrap anyway:", e?.message || e);
            send("bootstrap", "Could not verify dependencies; running bootstrap setup anyway…");
        }

        send("bootstrap", "Running setup script on the server… this may take several minutes.");

        const rebootRequired = await runBootstrapScript(
            host,
            username,
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

        return { success: true, reboot: rebootRequired };
    } catch (err: any) {
        const msg = err?.message || String(err);
        send("error", `Installation failed: ${msg}`);
        console.error("SSH failure:", err?.level, err?.description, err?.message);
        return { success: false, error: msg };
    }
}

