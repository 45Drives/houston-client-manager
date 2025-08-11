import path from "path";
import { app } from "electron";
import { NodeSSH } from "node-ssh";
import { checkSSH, setupSshKey, runBootstrapScript } from "./setupSsh";
import { getAgentSocket, getKeyDir, ensureKeyPair } from "./crossPlatformSsh";

export async function installServerDepsRemotely({
    host,
    username,
    password,
}: {
    host: string;
    username: string;
    password: string;
}) {
    try {
        // 1. Quick TCP check: is something listening on port 22?
        const reachable = await checkSSH(host);

        // 2. If it is, try to auth with your existing agent/key
        let hasAuth = false;
        const agentSock = getAgentSocket();
        if (reachable && agentSock) {
            const trial = new NodeSSH();
            try {
                await trial.connect({
                    host,
                    username,
                    agent: agentSock,
                    tryKeyboard: false,
                });
                hasAuth = true;
                trial.dispose();
            } catch {
                trial.dispose();
            }
        }

        // 3. Only generate & upload a key when you actually can’t auth
        if (!hasAuth) {
            await setupSshKey(host, username, password);
        }

        // 4. Now run your bootstrap script with whichever key we have
        // const privateKeyPath = path.join(
        //     app.getPath("userData"),
        //     ".ssh",
        //     "id_rsa"
        // );
        const keyDir = getKeyDir();
        const privateKeyPath = path.join(keyDir, "id_rsa");
        const publicKeyPath = `${privateKeyPath}.pub`;
        await ensureKeyPair(privateKeyPath, publicKeyPath);
        
        const rebootRequired = await runBootstrapScript(host, username, privateKeyPath);

        return { success: true, reboot: rebootRequired };
    } catch (err: any) {
        console.error(
            "SSH failure:",
            err.level,            // e.g. 'client-authentication'
            err.description,      // e.g. 'All configured authentication methods failed'
            err.message,          // e.g. 'Permission denied'
        );
        return { success: false, error: err.message || String(err) };
    }
}
