import { exec } from 'child_process';
import { getOS, getAsset, getAppPath } from '../utils';
import * as fs from 'fs';
import * as path from 'path';
import { BackUpTask } from '@45drives/houston-common-lib';

export async function checkBackupTaskStatus(task: BackUpTask): Promise<'online' | 'offline_unreachable' | 'offline_invalid_credentials' | 'offline_connection_error' | 'missing_folder' | 'checking'> {
    const os = getOS();
    const [smbHost, smbSharePath] = task.target.split(":");
    const smbShare = smbSharePath.split("/")[0];
    const targetPath = smbSharePath.substring(smbShare.length + 1); // drop share part

    // Extract credentials from generated script
    const scriptPath = path.join(getAppPath(), `run_backup_task_${task.uuid}.sh`);
    if (!fs.existsSync(scriptPath)) {
        console.warn(`Missing script: ${scriptPath}`);
        return 'offline_connection_error';
    }

    const content = fs.readFileSync(scriptPath, 'utf-8');
    const usernameMatch = content.match(/SMB_USER='([^']+)'/);
    const passwordMatch = content.match(/SMB_PASS='([^']+)'/);

    const username = usernameMatch?.[1];
    const password = passwordMatch?.[1];

    if (!username || !password) {
        console.warn(`Missing SMB credentials for ${task.uuid}`);
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

            if (error) {
                console.error(`Status script failed for ${task.uuid}:`, stderr || error);
                return resolve('offline_connection_error');
            }

            try {
                const json = JSON.parse(stdout.trim());
                return resolve(json.status || 'offline_connection_error');
            } catch (e) {
                console.warn(`Non-JSON output from status check for ${task.uuid}:`, stdout);
                return resolve('offline_connection_error');
            }
        });
    });
}
