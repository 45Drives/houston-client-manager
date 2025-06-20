import { setupSshKey, runBootstrapScript } from './setupSsh';
import path from 'path';
import { getAppPath } from './utils';

/**
 * Installs required server-side software (Node.js 18 + Cockpit module)
 * using SSH key-based automation after copying key with credentials.
 */
export async function installServerDepsRemotely({
    host,
    username,
    password
}: {
    host: string;
    username: string;
    password: string;
}) {
    try {
        await setupSshKey(host, username, password);

        const privateKeyPath = path.join(getAppPath(), '.ssh', 'id_rsa');
        await runBootstrapScript(host, username, privateKeyPath);

        return { success: true };
    } catch (err: any) {
        return { success: false, error: err };
    }
}
