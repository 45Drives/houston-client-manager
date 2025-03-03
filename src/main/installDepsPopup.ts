import { app, dialog } from 'electron';
import sudo from 'sudo-prompt';
import { execSync } from 'child_process';
import { getOS } from './utils';

const options = {
  name: 'Houston Client Manager',
};

// Define dependencies for each OS
const dependencies = {
  rocky: ['cifs-utils'],
  debian: ['cifs-utils'],
  mac: [], // macOS may not need these, but you can add specific ones
};


// Check if dependencies are installed
function missingDependencies(osType) {
  const packages = dependencies[osType] || [];
  const missing: string[] = [];

  packages.forEach((pkg: string) => {
    try {
      let command = '';
      if (osType === 'rocky') {
        command = `dnf list installed ${pkg}`;
      } else if (osType === 'debian') {
        command = `dpkg -l | grep ${pkg}`;
      }
      execSync(command, { stdio: 'ignore' });
    } catch {
      missing.push(pkg);
    }
  });

  return missing;
}

// Install Dependencies
function installDependencies(osType, missingPackages) {
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

  const missingPackages = missingDependencies(osType);
  if (missingPackages.length > 0) {
    installDependencies(osType, missingPackages);
  } else {
    console.log('All dependencies are already installed.');
  }
}
  