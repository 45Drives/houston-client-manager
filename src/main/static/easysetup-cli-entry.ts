/**
 * CLI entry point for EasySetupConfigurator.
 * This file is bundled with esbuild into a standalone Node.js script
 * that can be uploaded and executed on a remote server.
 *
 * Usage: echo '{"srvrName":"myserver",...}' | node easysetup-bundle.js
 *
 * Progress is emitted as JSON lines to stdout:
 *   {"step":1,"total":10,"message":"Initializing..."}
 *
 * Errors are emitted as:
 *   {"step":-1,"total":-1,"message":"Error: ..."}
 *
 * Final success is:
 *   {"step":10,"total":10,"message":"...","done":true,"hostnameChanged":true|false}
 */

import { EasySetupConfigurator, EasySetupProgress } from "@/managers/easysetup/manager";
import { EasySetupConfig } from "@/managers/easysetup/types";

// Patch: When running as root on the target server, skip pkexec.
// The nodeDriverLinuxProcess checks `process.env.VITEST` to skip pkexec,
// but we need a more general mechanism. We'll set a flag that the driver checks.
// Since the nodeDriver checks `command.options.superuser && !process.env.VITEST`,
// and we're running as root anyway, we can just set VITEST to skip it.
// Better: patch the environment so pkexec is skipped.
if (process.getuid && process.getuid() === 0) {
  // Already root — no need for privilege escalation
  process.env.__HOUSTON_SKIP_PKEXEC = "1";
}

function emitProgress(progress: EasySetupProgress & { done?: boolean; hostnameChanged?: boolean }) {
  process.stdout.write(JSON.stringify(progress) + "\n");
}

async function main() {
  // Read config from stdin
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks).toString("utf-8").trim();

  if (!input) {
    process.stderr.write(JSON.stringify({ error: "No config provided on stdin" }) + "\n");
    process.exit(1);
  }

  let config: EasySetupConfig;
  try {
    config = JSON.parse(input);
  } catch (e: any) {
    process.stderr.write(JSON.stringify({ error: `Invalid JSON: ${e.message}` }) + "\n");
    process.exit(1);
  }

  // Capture original hostname for change detection
  const { execSync } = await import("child_process");
  const originalHostname = execSync("hostname").toString().trim();

  const configurator = new EasySetupConfigurator();

  let lastStep = 0;
  await configurator.applyConfig(config, (progress) => {
    lastStep = progress.step;
    emitProgress(progress);
  });

  // Check if hostname changed
  const newHostname = execSync("hostname").toString().trim();
  const hostnameChanged = newHostname !== originalHostname;

  if (lastStep === 10) {
    // Final success signal with hostnameChanged flag
    emitProgress({
      step: 10,
      total: 10,
      message: "Setup complete!",
      done: true,
      hostnameChanged,
    });
  }
}

main().catch((err) => {
  process.stderr.write(JSON.stringify({ error: err.message || String(err) }) + "\n");
  process.exit(1);
});
