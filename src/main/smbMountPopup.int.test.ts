import { describe, it, expect, afterEach } from "vitest";
import os from "os";
import { exec as execCb } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { vi } from "vitest";
vi.mock("./utils", async () => {
  const actual = await vi.importActual<any>("./utils");
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  return {
    ...actual,
    getAsset: vi.fn(async (dir: string, filename: string) => {
      // Adjust this to match your repo layout.
      // If the test file is in src/main/, this resolves src/main/static/<file>
      return path.resolve(__dirname, "static", filename);
    }),
  };
});


// Update import to your module:
import mountSmbPopup from "./smbMountPopup";

const smb_host = "192.168.5.114";
const smb_share = "share";
const smb_user = "root";
const smb_pass = "password";

const exec = promisify(execCb);

function makeWindowStub() {
  return { webContents: { send: () => {} } } as any;
}

async function isMountedLinux(share: string): Promise<boolean> {
  // findmnt is reliable if present; fallback to mount output if needed
  try {
    const { stdout } = await exec(`findmnt -rn -t cifs,smb3,smbfs | cat`);
    return stdout.toLowerCase().includes(share.toLowerCase());
  } catch {
    const { stdout } = await exec(`mount | cat`);
    return stdout.toLowerCase().includes(share.toLowerCase());
  }
}

async function isMountedMac(host: string, share: string): Promise<boolean> {
  const { stdout } = await exec(`mount | cat`);
  // mac mount output commonly contains //user@host/share or //host/share
  const needle = `//${host}/${share}`.toLowerCase();
  return stdout.toLowerCase().includes(needle);
}

async function isMountedWindows(share: string): Promise<boolean> {
  // Check mappings. "net use" is broadly available.
  const { stdout } = await exec(`cmd /C "net use"`);
  // Expect something like \\HOST\\SHARE to appear
  return stdout.toLowerCase().includes(`\\\\`.toLowerCase()) && stdout.toLowerCase().includes(share.toLowerCase());
}

function escRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function getLinuxCifsTargets(host: string, share: string): Promise<string[]> {
  const needle = `//${host}/${share}`.toLowerCase();

  // Prefer findmnt because it can emit just the target column.
  try {
    // SOURCE TARGET FSTYPE ...
    const { stdout } = await exec(`findmnt -rn -t cifs,smb3,smbfs -o SOURCE,TARGET | cat`);
    return stdout
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean)
      .map(line => {
        const parts = line.split(/\s+/);
        const source = (parts[0] ?? "").toLowerCase();
        const target = parts[1] ?? "";
        return { source, target };
      })
      .filter(x => x.source.includes(needle))
      .map(x => x.target)
      .filter(Boolean);
  } catch {
    // Fallback: parse `mount` output.
    // Example: //host/share on /mnt/point type cifs (...)
    const { stdout } = await exec(`mount | cat`);
    const re = new RegExp(`^//${escRe(host)}/${escRe(share)}\\s+on\\s+([^\\s]+)\\s+type\\s+`, "im");
    const targets: string[] = [];
    for (const line of stdout.split("\n")) {
      const m = line.match(re);
      if (m?.[1]) targets.push(m[1]);
    }
    return targets;
  }
}

async function getMacSmbTargets(host: string, share: string): Promise<string[]> {
  // Typical: //user@host/share on /Volumes/share (smbfs, nodev, nosuid, mounted by ...)
  const { stdout } = await exec(`mount | cat`);
  const re = new RegExp(`//[^\\s]*@?${escRe(host)}/${escRe(share)}\\s+on\\s+([^\\s]+)\\s+\\(`, "i");
  const targets: string[] = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(re);
    if (m?.[1]) targets.push(m[1]);
  }
  return targets;
}

async function getWindowsNetUseTargets(host: string, share: string): Promise<string[]> {
  // `net use` output includes lines like:
  // OK           Z:        \\HOST\share        Microsoft Windows Network
  const { stdout } = await exec(`cmd /C "net use"`);
  const uncNeedle = `\\\\${host}\\${share}`.toLowerCase();

  const targets: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const lower = line.toLowerCase();
    if (!lower.includes(uncNeedle)) continue;

    // Try to capture a drive letter mapping in column 2: e.g. "Z:"
    const m = line.match(/\s([A-Z]:)\s+/);
    if (m?.[1]) {
      targets.push(m[1]);
    } else {
      // If it’s a UNC-only mapping without a drive letter, delete by UNC
      targets.push(`\\\\${host}\\${share}`);
    }
  }
  return targets;
}

export async function unmountMountedShare(host: string, share: string): Promise<void> {
  const platform = os.platform();

  if (platform === "linux") {
    const targets = await getLinuxCifsTargets(host, share);
    for (const t of targets) {
      await exec(`sudo umount "${t}" 2>/dev/null || true`);
    }
  } else if (platform === "darwin") {
    const targets = await getMacSmbTargets(host, share);
    for (const t of targets) {
      await exec(`diskutil unmount "${t}" >/dev/null 2>&1 || umount "${t}" >/dev/null 2>&1 || true`);
    }
  } else if (platform === "win32") {
    const targets = await getWindowsNetUseTargets(host, share);
    for (const t of targets) {
      // net use can delete by drive letter or UNC path
      await exec(`cmd /C "net use ${t} /delete /y" >NUL 2>&1 || exit /b 0`);
    }
  }
}

afterEach(async () => {
  await unmountMountedShare(smb_host, smb_share);
});

describe("SMB mount integration", () => {
  it("actually mounts and is detectable by the OS", async () => {

    const mainWindow = makeWindowStub();

    const res = await mountSmbPopup(smb_host, smb_share, smb_user, smb_pass, mainWindow, "silent");

    // The function’s return value varies by OS/script; we don’t rely on it alone.
    // We verify mount state from the OS.
    const platform = os.platform();
    if (platform === "linux") {
      expect(await isMountedLinux(smb_share)).toBe(true);
    } else if (platform === "darwin") {
      expect(await isMountedMac(smb_host, smb_share)).toBe(true);
    } else if (platform === "win32") {
      expect(await isMountedWindows(smb_share)).toBe(true);
    } else {
      throw new Error(`Unsupported platform for integration test: ${platform}`);
    }

    expect(typeof res).toBe("string");
    expect(res).toBe('{"MountPoint": "/mnt/houston-mounts/' + smb_share + '", "smb_server": "' + smb_host + '"}')
  },
  120_000);
});
