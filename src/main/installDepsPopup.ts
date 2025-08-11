import { app, dialog } from 'electron';
import sudo from 'sudo-prompt';
import { getOS } from './utils';
import { exec } from 'child_process';

const options = {
  name: '45Drives Setup Wizard',
};

const dependencies: Record<string, string[]> = {
  rocky: ['cifs-utils', 'samba', 'samba-client'],
  debian: ['cifs-utils', 'samba', 'smbclient'],
  mac: ['samba'], // Homebrew installs smbclient and related tools
};

function checkMissingDependencies(osType: string): Promise<string[]> {
  const packages = dependencies[osType] || [];

  const checks = packages.map((pkg) => {
    return new Promise<string | null>((resolve) => {
      let command = '';

      if (osType === 'rocky') {
        command = `dnf list installed ${pkg}`;
      } else if (osType === 'debian') {
        command = `dpkg -l | grep -w ${pkg}`;
      } else if (osType === 'mac') {
        command = `brew list --formula | grep -w ${pkg}`;
      } else {
        resolve(null);
        return;
      }

      exec(command, (error, stdout) => {
        if (error || !stdout.includes(pkg)) {
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
  } else if (osType === 'mac') {
    command = `brew install ${packageList}`;
  } else {
    dialog.showErrorBox('Unsupported OS', 'Dependency installation not supported on this OS.');
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
      if (result.response !== 0) return;

      if (osType === 'mac') {
        exec('which brew', (brewErr, brewPath) => {
          if (brewErr || !brewPath.trim()) {
            dialog.showErrorBox(
              'Missing Homebrew',
              'Homebrew is required to install dependencies on macOS.\nPlease install it from https://brew.sh and try again.'
            );
            return;
          }

          sudo.exec(command, options, (error, stdout) => {
            if (error) {
              console.error('Installation Error:', error);
              dialog.showErrorBox('Installation Failed', 'Could not install dependencies.');
              return;
            }

            console.debug('Installation Output:', stdout);
            dialog.showMessageBox({
              type: 'info',
              title: 'Installation Complete',
              message: 'All required dependencies have been installed successfully!',
            });
          });
        });
      } else {
        // Linux-based flow
        sudo.exec(command, options, (error, stdout) => {
          if (error) {
            console.error('Installation Error:', error);
            dialog.showErrorBox('Installation Failed', 'Could not install dependencies.');
            return;
          }

          console.debug('Installation Output:', stdout);
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
      console.warn(`[Dependencies] Missing: ${missingPackages.join(', ')}`);
      installDependencies(osType, missingPackages);
    } else {
      console.debug('All dependencies are already installed.');
    }
  });
}
