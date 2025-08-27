import { exec, execFile, execSync } from 'child_process';
import { getOS, getAsset, getAppPath } from '../utils';
import * as fs from 'fs';
import * as osDir from 'os';
import * as path from 'path';
import { BackUpTask } from '@45drives/houston-common-lib';

export async function checkBackupTaskStatus(task: BackUpTask): Promise<BackUpTask['status']> {
    const os = getOS();
    const smbHost = task.host!;
    const smbShare = task.share!;
    const targetPath = task.target!;
    const homeDir = osDir.homedir();

    const credPath =
        os === 'win'
            ? path.join(process.env.ProgramData || 'C:\\ProgramData', 'houston-backups', 'credentials', `${smbShare}.cred`)
            : os === 'mac'
                ? `${homeDir}/houston-credentials/${smbShare}.cred`
                : `/etc/samba/houston-credentials/${smbShare}.cred`;

    if (!fs.existsSync(credPath)) {
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

        const scriptAsset = await getAsset("static", "check_smb_task_status.sh");
        const escape = (arg: string) => `"${arg.replace(/(["\\$`])/g, '\\$1')}"`;
        const cmd = `bash ${escape(scriptAsset)} ${escape(smbHost)} ${escape(smbShare)} ${escape(targetPath)} ${escape(credPath)}`;

        return new Promise((resolve) => {
            exec(cmd, (error, stdout, stderr) => {
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