const { execFile } = require("child_process");
const { promisify } = require("util");
const { join } = require("path");
const run = promisify(execFile);

exports.default = async function (context) {
    const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    await run("codesign", ["-vvv", "--deep", "--strict", "--verify", app]);
};