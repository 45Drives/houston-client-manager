/**
 * Bundle the EasySetupConfigurator into a standalone Node.js CLI script.
 * This outputs a single self-contained .js file that can be uploaded to
 * a target server and run with: echo '<config>' | node easysetup-bundle.js
 */
import { build } from "esbuild";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const libDir = path.resolve(rootDir, "houston-common/houston-common-lib/lib");
const entryPoint = path.resolve(rootDir, "src/main/static/easysetup-cli-entry.ts");
const outFile = path.resolve(rootDir, "src/main/static/easysetup-bundle.js");
const shimsDir = path.resolve(rootDir, "src/main/static/easysetup-shims");

// Plugin to handle Vite's `?raw` import syntax — loads file as text string
const rawPlugin = {
  name: "raw-loader",
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => {
      let cleanPath = args.path.replace(/\?raw$/, "");
      // Resolve @/ alias
      if (cleanPath.startsWith("@/")) {
        cleanPath = path.resolve(libDir, cleanPath.slice(2));
      } else {
        cleanPath = path.resolve(path.dirname(args.importer), cleanPath);
      }
      return { path: cleanPath, namespace: "raw-file" };
    });
    build.onLoad({ filter: /.*/, namespace: "raw-file" }, async (args) => {
      const contents = await fs.promises.readFile(args.path, "utf-8");
      return { contents: `export default ${JSON.stringify(contents)};`, loader: "js" };
    });
  },
};

// Plugin to stub out cockpit-dependent legacy modules that can't run in Node.js
const legacyStubPlugin = {
  name: "legacy-stub",
  setup(build) {
    // Intercept @/legacy and @/legacy/* imports
    build.onResolve({ filter: /^@\/legacy/ }, () => {
      return { path: "legacy-stub", namespace: "legacy-stub" };
    });
    // Intercept cockpit module import
    build.onResolve({ filter: /^cockpit$/ }, () => {
      return { path: "cockpit-stub", namespace: "legacy-stub" };
    });
    build.onLoad({ filter: /.*/, namespace: "legacy-stub" }, () => {
      return {
        contents: `
          export function useSpawn() { throw new Error('useSpawn (cockpit) not available in CLI mode'); }
          export function errorString(state) { return state?.stderr || 'unknown error'; }
          export class BetterCockpitFile { constructor() { throw new Error('BetterCockpitFile not available in CLI mode'); } }
          export class SSHAuthorizedKeysSyntax { constructor() { throw new Error('SSHAuthorizedKeysSyntax not available in CLI mode'); } }
          export default { spawn() { throw new Error('cockpit.spawn not available in CLI mode'); }, file() { throw new Error('cockpit.file not available in CLI mode'); } };
        `,
        loader: "js",
      };
    });
  },
};

async function bundle() {
  await build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    outfile: outFile,
    // Resolve the @/ path alias used throughout houston-common-lib
    alias: {
      "@": libDir,
      "vue": path.resolve(shimsDir, "vue.js"),
    },
    plugins: [legacyStubPlugin, rawPlugin],
    // These are Node.js built-ins — don't bundle them
    external: [
      "child_process",
      "fs",
      "path",
      "os",
      "stream",
      "util",
      "events",
      "buffer",
      "crypto",
      "net",
      "tty",
      "node:buffer",
      "node:child_process",
      "node:fs",
      "node:path",
      "node:os",
      "node:stream",
      "node:util",
      "node:events",
      "node:crypto",
      "node:net",
    ],
    // Tree-shake unused code
    treeShaking: true,
    // Don't minify — easier to debug on server if something goes wrong
    minify: false,
    // Silence warnings about circular deps in neverthrow etc.
    logLevel: "warning",
    banner: {
      js: "#!/usr/bin/env node\n// Auto-generated EasySetup CLI bundle — do not edit manually",
    },
  });

  console.log(`✓ Bundled EasySetup CLI → ${path.relative(process.cwd(), outFile)}`);
}

bundle().catch((err) => {
  console.error("Bundle failed:", err);
  process.exit(1);
});
