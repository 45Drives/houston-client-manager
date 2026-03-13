const { execFile } = require("child_process");
const { promisify } = require("util");
const { join } = require("path");
const { existsSync } = require("fs");
const run = promisify(execFile);

exports.default = async function (context) {
    if (process.env.SKIP_AFTER_SIGN === "1") return;
    const platform = context?.electronPlatformName || process.platform;
    if (platform !== "darwin") return;

    const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    if (!existsSync(app)) return;
    await run("codesign", ["-vvv", "--deep", "--strict", "--verify", app]);
};