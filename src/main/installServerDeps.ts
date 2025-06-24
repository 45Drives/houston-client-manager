import path from "path";
import { app } from "electron";
import { NodeSSH } from "node-ssh";
import { checkSSH, setupSshKey, runBootstrapScript } from "./setupSsh";

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
        if (reachable && process.env.SSH_AUTH_SOCK) {
            const trial = new NodeSSH();
            try {
                await trial.connect({
                    host,
                    username,
                    agent: process.env.SSH_AUTH_SOCK,
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
        const privateKeyPath = path.join(
            app.getPath("userData"),
            ".ssh",
            "id_rsa"
        );
        const rebootRequired = await runBootstrapScript(host, username, privateKeyPath);

        return { success: true, reboot: rebootRequired };
    } catch (err: any) {
        return { success: false, error: err.message || err };
    }
}
