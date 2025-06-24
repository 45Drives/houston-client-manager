import { exec } from 'child_process';
import { getOS, getAsset, getAppPath } from '../utils';
import * as fs from 'fs';
import * as path from 'path';
import * as nodeOs from 'os';
import { BackUpTask } from '@45drives/houston-common-lib';

export async function checkBackupTaskStatus(task: BackUpTask): Promise<'online' | 'offline_unreachable' | 'offline_invalid_credentials' | 'offline_connection_error' | 'missing_folder' | 'checking' | 'offline_insufficient_permissions'> {
    const os = getOS();
    // const [smbHost, smbSharePath] = task.target.split(":");
    // const smbShare = smbSharePath.split("/")[0];
    // const targetPath = smbSharePath.substring(smbShare.length + 1); // drop share part
    const smbHost = task.host!;
    const smbShare = task.share!;
    const targetPath = task.target;

    // Extract credentials from generated script
    // const scriptPath = path.join(getAppPath(), `run_backup_task_${task.uuid}.sh`);
    const scriptPath = path.join(
        nodeOs.homedir(),
        ".local",
        "share",
        "houston-backups",
        `run_backup_task_${task.uuid}.sh`
      );

    if (!fs.existsSync(scriptPath)) {
        console.warn(`Missing script: ${scriptPath}`);
        return 'offline_connection_error';
    }

    const credPath = `/etc/samba/houston-credentials/${smbShare}.cred`;

    if (!fs.existsSync(credPath)) {
        console.warn(`Credential file missing: ${credPath}`);
        return 'offline_invalid_credentials';
    }

    const credContent = fs.readFileSync(credPath, 'utf-8');
    const usernameMatch = credContent.match(/username=(.+)/);
    const passwordMatch = credContent.match(/password=(.+)/);

    const username = usernameMatch?.[1]?.trim();
    const password = passwordMatch?.[1]?.trim();

    if (!username || !password) {
        console.warn(`Credential file incomplete for ${task.uuid}`);
        return 'offline_invalid_credentials';
    }

    let scriptAsset;
    if (os === 'win') {
        scriptAsset = await getAsset("static", "check_smb_task_status_win.bat");
    } else if (os === 'mac') {
        scriptAsset = await getAsset("static", "check_smb_task_status.sh");
    } else {
        scriptAsset = await getAsset("static", "check_smb_task_status.sh");
    }

    // Prepare and run script
    return new Promise((resolve) => {
        const cmd = `${os === 'win' ? '' : 'bash'} "${scriptAsset}" "${smbHost}" "${smbShare}" "${targetPath}" "${username}" "${password}"`;
        exec(cmd, (error, stdout, stderr) => {
            console.log(`[SMB Check] stdout for ${task.uuid}:`, stdout);
            console.error(`[SMB Check] stderr for ${task.uuid}:`, stderr);
            console.error(`[SMB Check] error for ${task.uuid}:`, error);

            if (error) {
                console.error(`Status script failed for ${task.uuid}:`, stderr || error);
                return resolve('offline_connection_error');
            }

            try {
                const jsonLine = stdout.trim().split('\n').find(line => line.trim().startsWith('{'));
                if (!jsonLine) throw new Error("Missing JSON output");
                const json = JSON.parse(jsonLine);
                return resolve(json.status || 'offline_connection_error');
            } catch (e) {
                console.warn(`Non-JSON output from status check for ${task.uuid}:`, stdout);
                return resolve('offline_connection_error');
              }
        });
    });
}
