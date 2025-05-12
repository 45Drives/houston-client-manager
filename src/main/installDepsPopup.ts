import { app, dialog } from 'electron';
import sudo from 'sudo-prompt';
import { getOS } from './utils';
import { exec } from 'child_process';

const options = {
  name: '45Drives Setup Wizard',
};

const dependencies = {
  rocky: ['cifs-utils', 'samba', 'samba-client'],
  debian: ['cifs-utils', 'samba', 'smbclient'],
  mac: [],
};

// Returns a Promise that resolves with the list of missing packages
function checkMissingDependencies(osType: string): Promise<string[]> {
  const packages = dependencies[osType] || [];

  const checks = packages.map((pkg) => {
    return new Promise<string | null>((resolve) => {
      let command = '';

      if (osType === 'rocky') {
        command = `dnf list installed ${pkg}`;
      } else if (osType === 'debian') {
        command = `dpkg -l | grep ${pkg}`;
      } else {
        resolve(null);
        return;
      }

      exec(command, (error, stdout, stderr) => {
        if (error || !stdout!.includes(pkg)) {
          resolve(pkg); // missing
        } else {
          resolve(null); // found
        }
      });
    });
  });

  return Promise.all(checks).then((results) => results.filter(Boolean) as string[]);
}

function installDependencies(osType: string, missingPackages: string[]) {
  if (missingPackages.length === 0) return;

  const packageList = missingPackages.join(' ');
  let command = '';

  if (osType === 'rocky') {
    command = `dnf install -y ${packageList}`;
  } else if (osType === 'debian') {
    command = `apt-get install -y ${packageList}`;
  } else {
    dialog.showMessageBox({
      type: 'info',
      title: 'Installation Not Required',
      message: 'No dependencies need to be installed for macOS.',
    });
    return;
  }

  dialog
    .showMessageBox({
      type: 'info',
      title: 'System Dependencies Required',
      message: `The following dependencies are missing:\n\n${missingPackages.join(
        '\n'
      )}\n\nYou will need to enter your administrator password to install them.`,
      buttons: ['OK', 'Cancel'],
    })
    .then((result) => {
      if (result.response === 0) {
        sudo.exec(command, options, (error, stdout, stderr) => {
          if (error) {
            console.error('Installation Error:', error);
            dialog.showErrorBox('Installation Failed', 'Could not install dependencies.');
            return;
          }
          console.log('Installation Output:', stdout);
          dialog.showMessageBox({
            type: 'info',
            title: 'Installation Complete',
            message: 'All required dependencies have been installed successfully!',
          });
        });
      }
    });
}

// Main Logic
export default function installDepPopup() {
  const osType = getOS();
  if (!osType) {
    dialog.showErrorBox('Unsupported OS', 'Could not determine your OS type.');
    return;
  }

  checkMissingDependencies(osType).then((missingPackages) => {
    if (missingPackages.length > 0) {
      installDependencies(osType, missingPackages);
    } else {
      console.log('All dependencies are already installed.');
    }
  });
}
