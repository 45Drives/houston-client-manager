import log from 'electron-log';
// log.transports.console.level = false;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
console.log = (...args) => log.info(...args);
console.error = (...args) => log.error(...args);
console.warn = (...args) => log.warn(...args);
console.debug = (...args) => log.debug(...args);

process.on('uncaughtException', (error) => {
  log.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

import { exec, execSync } from 'child_process';
import { getOS, getAsset, getAppPath } from '../utils';
import * as fs from 'fs';
import * as path from 'path';
import * as nodeOs from 'os';
import { BackUpTask } from '@45drives/houston-common-lib';

export async function checkBackupTaskStatus(task: BackUpTask): Promise<BackUpTask['status']> {
    const os = getOS();
    const smbHost = task.host!;
    const smbShare = task.share!;
    const targetPath = task.target;

    const scriptPath = path.join(
        nodeOs.homedir(),
        ".local",
        "share",
        "houston-backups",
        `Houston_Backup_Task_${task.uuid}.sh`
    );

    if (!fs.existsSync(scriptPath)) {
        console.warn(`[SMB Check] Missing backup script for ${task.uuid}: ${scriptPath}`);
        return 'offline_connection_error';
    }

    const credPath = `/etc/samba/houston-credentials/${smbShare}.cred`;
    if (!fs.existsSync(credPath)) {
        console.warn(`[SMB Check] Missing credentials for ${task.uuid}: ${credPath}`);
        return 'offline_invalid_credentials';
    }

    const credContent = fs.readFileSync(credPath, 'utf-8');
    const username = credContent.match(/username=(.+)/)?.[1]?.trim();
    const password = credContent.match(/password=(.+)/)?.[1]?.trim();

    if (!username || !password) {
        console.warn(`[SMB Check] Incomplete credentials for ${task.uuid}`);
        return 'offline_invalid_credentials';
    }

    let scriptAsset: string;
    if (os === 'win') {
        scriptAsset = await getAsset("static", "check_smb_task_status_win.bat");
    } else {
        if (os === 'mac' && !hasSmbClient()) {
            console.warn("smbclient not found on macOS. Recommend: brew install samba");
            return 'offline_connection_error';
        }
        scriptAsset = await getAsset("static", "check_smb_task_status.sh");
    }

    // const cmd = `${os === 'win' ? '' : 'bash'} "${scriptAsset}" "${smbHost}" "${smbShare}" "${targetPath}" "${username}" "${password}"`;
    const escape = (arg: string) => `"${arg.replace(/(["\\$`])/g, '\\$1')}"`;
    const cmd = `${os === 'win' ? '' : 'bash'} ${escape(scriptAsset)} ${escape(smbHost)} ${escape(smbShare)} ${escape(targetPath)} ${escape(username)} ${escape(password)}`;

    return new Promise((resolve) => {
        exec(cmd, (error, stdout, stderr) => {
            console.log(`[SMB Check] stdout for ${task.uuid}:`, stdout);
            if (stderr) console.warn(`[SMB Check] stderr for ${task.uuid}:`, stderr);

            let jsonLine = stdout?.trim().split('\n').find(line => line.trim().startsWith('{'));
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