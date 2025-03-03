const ChildProcess = require('child_process');
const Chalk = require('chalk');

function compile(directory) {
  console.log("compileDir:", directory);

  return new Promise((resolve, reject) => {
    const tscProcess = ChildProcess.exec('tsc', { cwd: directory });

    // Handle stdout
    tscProcess.stdout.on('data', data => {
      process.stdout.write(Chalk.yellowBright(`[tsc] `) + Chalk.white(data.toString()));
    });

    // Handle stderr
    tscProcess.stderr.on('data', data => {
      process.stderr.write(Chalk.red(`[tsc ERROR] `) + Chalk.white(data.toString()));
    });

    // Handle process errors
    tscProcess.on('error', (err) => {
      console.error(Chalk.red('Error starting the process:', err));
      reject(err);
    });

    // Handle process exit
    tscProcess.on('exit', exitCode => {
      if (exitCode > 0) {
        console.log(Chalk.red('TypeScript compilation failed with exit code:', exitCode));
        reject(new Error(`TypeScript compilation failed with exit code: ${exitCode}`));
      } else {
        console.log(Chalk.green('TypeScript compilation completed successfully.'));
        resolve();
      }
    });
  });
}

module.exports = compile;
