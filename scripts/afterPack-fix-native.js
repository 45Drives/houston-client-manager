const { execFile } = require("child_process");
const { promisify } = require("util");
const { join } = require("path");
const run = promisify(execFile);

exports.default = async function (context) {
    const appPath = join(
        context.appOutDir,
        `${context.packager.appInfo.productFilename}.app`
    );

    // 1) Clear quarantine recursively (prevents errSecInternalComponent)
    try { await run("xattr", ["-dr", "com.apple.quarantine", appPath]); } catch { }

    // 2) Ensure writable so codesign can embed new signatures
    try { await run("chmod", ["-R", "u+w", appPath]); } catch { }

    // 3) Remove any stale signatures on native binaries
    try {
        const { stdout } = await run("find", [
            appPath, "-type", "f",
            "(", "-name", "*.node", "-o", "-name", "*.dylib", ")"
        ]);
        const files = stdout.split("\n").filter(Boolean);
        for (const f of files) {
            try { await run("codesign", ["--remove-signature", f]); } catch { }
        }
    } catch { }
};
