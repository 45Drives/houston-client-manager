import { execSync } from 'child_process';
import os from 'os';

export function getOS(): 'mac' | 'rocky' | 'debian' | 'win' {
  const platform = os.platform();
  if (platform === 'darwin') return 'mac';
  try {
    const releaseInfo = execSync('cat /etc/os-release', { encoding: 'utf-8' }).toLowerCase();
    if (releaseInfo.toLocaleLowerCase().includes('rocky')) return 'rocky';
    if (releaseInfo.includes('debian') || releaseInfo.includes('ubuntu')) return 'debian';
  } catch (error) {
  }
  return "win";
}
