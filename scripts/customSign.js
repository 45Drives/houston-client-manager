const { sign } = require('electron-osx-sign');

module.exports = async function customSign(config) {
  const ignoreExtensions = [".blend", ".glb", ".obj", ".fbx", ".dae"];

  const ignoreFn = (filePath) => {
    return ignoreExtensions.some(ext => filePath.endsWith(ext));
  };

  console.log("🔏 Starting custom macOS signing...");

  await sign({
    app: config.app,
    identity: config.identity,
    "hardened-runtime": true,
    entitlements: config.entitlements,
    "entitlements-inherit": config.entitlementsInherit,
    "signature-flags": "library",
    ignore: ignoreFn
  });

  console.log("✅ Custom signing complete.");
};
