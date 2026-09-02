import { exec, execFile, execSync } from 'child_process';
import { getOS, getAsset, getAppPath } from '../utils';
import * as fs from 'fs';
import * as osDir from 'os';
import * as path from 'path';
import { BackUpTask } from '@45drives/houston-common-lib';
import { MAC_CRED_DIR } from './macDaemon';

export async function checkBackupTaskStatus(task: BackUpTask): Promise<BackUpTask['status']> {
    const os = getOS();
    const smbHost = task.host!;
    const smbShare = task.share!;
    const targetPath = task.target!;
    const homeDir = osDir.homedir();

    const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '_');
    const smbUser = task.smb_user || '';
    const credKey = `${safe(smbHost)}_${safe(smbShare)}_${safe(smbUser)}`;

    // Mac: check credential file first (new user-space path), then keychain (legacy)
    if (os === 'mac') {
        const macCredPath = path.join(MAC_CRED_DIR, `${credKey}.cred`);
        const hasCredFile = fs.existsSync(macCredPath);
        if (!hasCredFile) {
            try {
                execSync(
                    `security find-generic-password -s ${JSON.stringify(`houston-smb-${smbHost}-${smbShare}-${smbUser}`)} -a ${JSON.stringify(smbUser)} -w`,
                    { stdio: 'pipe' }
                );
            } catch {
                console.warn(`[SMB Check] Missing credentials for ${task.uuid}: no cred file at ${macCredPath} and no keychain entry`);
                return 'offline_invalid_credentials';
            }
        }
    }

    const credPath =
        os === 'win'
            ? path.join(
                process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'),
                'houston-backups', 'credentials', `${credKey}.cred`)
            : `/etc/samba/houston-credentials/${credKey}.cred`;

    if (os !== 'mac' && !fs.existsSync(credPath)) {
        console.warn(`[SMB Check] Missing credentials for ${task.uuid}: ${credPath}`);
        return 'offline_invalid_credentials';
    }

    if (os === 'win') {
        const scriptAsset = await getAsset('static', 'check_smb_task_status_win.bat');
        console.debug(`[SMB Check] execFile: ${scriptAsset} [${task.host}, ${task.share}, ${task.target}, ${credPath}]`);

        return new Promise<BackUpTask['status']>(resolve => {
            execFile(
                `"${scriptAsset}"`,
                [`"${task.host!}"`, `"${task.share!}"`, `"${task.target!}"`, `"${credPath}"`],
                { windowsHide: true, shell: true },
                (error, stdout, stderr) => {
                    console.debug(`[SMB Check] stdout for ${task.uuid}:`, stdout);
                    if (stderr) console.warn(`[SMB Check] stderr for ${task.uuid}:`, stderr);

                    const jsonLine = stdout.trim().split('\n').find(line => line.trim().startsWith('{'));
                    if (!jsonLine) {
                        console.warn(`[SMB Check] No JSON output for ${task.uuid}`, error);
                        return resolve('offline_connection_error');
                    }

                    try {
                        const { status = 'offline_connection_error' } = JSON.parse(jsonLine);
                        if (status === 'missing_folder' && isScheduledButNotRunYet(task)) {
                            return resolve('missing_folder');
                        }
                        resolve(status as BackUpTask['status']);
                    } catch {
                        console.warn(`[SMB Check] JSON parse error for ${task.uuid}:`, jsonLine);
                        resolve('offline_connection_error');
                    }
                }
            );
        });
    } else {
        if (os === 'mac' && !hasSmbClient()) {
            console.warn("smbclient not found on macOS. Recommend: brew install samba");
            return 'offline_connection_error';
        }

        const scriptName = os === 'mac' ? 'check_smb_task_status_mac.sh' : 'check_smb_task_status.sh';
        const scriptAsset = await getAsset("static", scriptName);
        const escape = (arg: string) => `"${arg.replace(/(["\\$`])/g, '\\$1')}"`;

        // The check script reads a Linux/Windows-shaped .cred file. Since the daemon rewrite
        // that file already exists on disk, so only pre-daemon installs still fall back to the
        // keychain — which exportMacCredFile deletes once it has migrated an entry.
        let effectiveCredPath = credPath;
        let tempCredPath: string | null = null;
        if (os === 'mac') {
            const macCredPath = path.join(MAC_CRED_DIR, `${credKey}.cred`);
            if (fs.existsSync(macCredPath)) {
                effectiveCredPath = macCredPath;
            } else {
                try {
                    const pw = execSync(
                        `security find-generic-password -s ${JSON.stringify(`houston-smb-${smbHost}-${smbShare}-${smbUser}`)} -a ${JSON.stringify(smbUser)} -w`,
                        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
                    ).trim();
                    tempCredPath = path.join(osDir.tmpdir(), `houston-smb-check-${task.uuid}.cred`);
                    fs.writeFileSync(tempCredPath, `username=${smbUser}\npassword=${pw}\n`, { mode: 0o600 });
                    effectiveCredPath = tempCredPath;
                } catch {
                    return 'offline_invalid_credentials';
                }
            }
        }

        const cmd = `bash ${escape(scriptAsset)} ${escape(smbHost)} ${escape(smbShare)} ${escape(targetPath)} ${escape(effectiveCredPath)}`;

        return new Promise((resolve) => {
            exec(cmd, (error, stdout, stderr) => {
                // Only ever the throwaway copy — never the real cred file.
                if (tempCredPath) {
                    try { fs.unlinkSync(tempCredPath); } catch {}
                }

                console.debug(`[SMB Check] stdout for ${task.uuid}:`, stdout);
                if (stderr) console.warn(`[SMB Check] stderr for ${task.uuid}:`, stderr);

                const jsonLine = stdout?.trim().split('\n').find(line => line.trim().startsWith('{'));
                if (!jsonLine) {
                    console.warn(`[SMB Check] No JSON output for ${task.uuid}, falling back`);
                    if (error) console.error(`[SMB Check] exec error:`, error);
                    return resolve('offline_connection_error');
                }

                try {
                    const json = JSON.parse(jsonLine);
                    const status = json.status || 'offline_connection_error';

                    if (status === 'missing_folder' && isScheduledButNotRunYet(task)) {
                        return resolve('missing_folder');
                    }

                    return resolve(status);
                } catch (e) {
                    console.warn(`[SMB Check] Failed to parse JSON for ${task.uuid}:`, jsonLine);
                    return resolve('offline_connection_error');
                }
            });
        });
    }
}


function isScheduledButNotRunYet(task: BackUpTask): boolean {
    const now = Date.now();
    return new Date(task.schedule.startDate).getTime() > now;
}

function hasSmbClient(): boolean {
    try {
        execSync('which smbclient', { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}