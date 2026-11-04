// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shellQuote } from './security';
import {
  restoreStorageScript, serverRestoreCommand,
} from './restoreStorage';

const mocks = vi.hoisted(() => ({
  execCommand: vi.fn(),
  dispose: vi.fn(),
  spawn: vi.fn(),
  credentials: vi.fn<() => Array<{ share: string }>>(() => []),
  credential: vi.fn(),
}));
vi.mock('./sshPool', () => ({
  acquireSSH: vi.fn(async () => ({ execCommand: mocks.execCommand, dispose: mocks.dispose })),
}));
vi.mock('./setupSsh', () => ({}));
vi.mock('./crossPlatformSsh', () => ({ getKeyDir: () => '/test/keys' }));
vi.mock('./settingsStore', () => ({ loadSettings: () => ({}) }));
vi.mock('./credentialManager', () => ({
  getCredentialManager: () => ({
    getForHost: () => undefined,
    listForHost: mocks.credentials,
    findByHostAndShare: mocks.credential,
  }),
}));
vi.mock('./utils', () => ({ getMountSmbScript: () => '/test/mount-smb' }));
vi.mock('./logging', () => ({
  errMsg: (err: unknown) => err instanceof Error ? err.message : String(err),
  logEvent: vi.fn(),
}));
vi.mock('child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('child_process')>(),
  spawn: mocks.spawn,
  execSync: vi.fn(() => '{"DriveLetter":"Z"}'),
}));

import {
  restoreToServer, restoreFromS2S, restoreFromSnapshot, restoreToClient,
  restoreS2SToClient, createServerDirectory, createZfsDatasetOnServer,
  listRestoreDestinations,
} from './restoreManager';

// Only mountinfo is simulated. Resolution, symlinks, mkdir, cwd and writes run
// through the actual remote Python program against an isolated filesystem tree.
const harness = `
import builtins, io, sys
from unittest.mock import patch
script, mountinfo = sys.argv[1:3]
sys.argv = ['restore-storage'] + sys.argv[3:]
real_open = builtins.open
def fixture_open(file, *args, **kwargs):
    if file == '/proc/self/mountinfo':
        return io.StringIO(mountinfo)
    return real_open(file, *args, **kwargs)
with patch('builtins.open', fixture_open):
    exec(compile(script, '<restore-storage>', 'exec'))
`;

let fixture: string;
let storage: string;
let osDisk: string;
let mountinfo: string;
let bin: string;
const originalPlatform = process.platform;

function mount(target: string, fstype = 'zfs', source = 'pool/data', options = 'rw', device?: string) {
  const escaped = target.replace(/\\/g, '\\134').replace(/ /g, '\\040');
  const dev = fs.statSync(target).dev;
  // Linux dev_t encoding (the fixture normally uses a small overlay device).
  const major = Math.floor(dev / 256) % 4096;
  const minor = dev % 256 + Math.floor(dev / 1048576) * 256;
  return `1 0 ${device ?? `${major}:${minor}`} / ${escaped} ${options} - ${fstype} ${source} ${options}\n`;
}

function runStorage(mode: string, destination = '', command = '') {
  return spawnSync('python3', ['-c', harness, restoreStorageScript, mountinfo, mode, destination, command], {
    encoding: 'utf8',
  });
}

function remoteCommand(command: string) {
  const prefix = `python3 -c ${shellQuote(restoreStorageScript)}`;
  const guarded = command.replace(`sudo ${prefix}`, prefix).replace(
    prefix,
    `python3 -c ${shellQuote(harness)} ${shellQuote(restoreStorageScript)} ${shellQuote(mountinfo)}`,
  );
  const result = spawnSync('/bin/sh', ['-c', guarded], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-storage-test-'));
  storage = path.join(fixture, 'mounted ZFS');
  osDisk = path.join(fixture, 'os');
  bin = path.join(fixture, 'bin');
  for (const dir of [storage, osDisk, bin]) fs.mkdirSync(dir);
  mountinfo = mount('/', 'ext4', '/dev/os') + mount(storage);
  for (const command of ['rsync', 'rclone']) {
    fs.writeFileSync(path.join(bin, command), '#!/bin/sh\nprintf restored > restored.txt\n', { mode: 0o755 });
  }
  mocks.execCommand.mockImplementation(async (command: string) => {
    if (command.startsWith('zfs get')) return { code: 0, stdout: storage, stderr: '' };
    if (command.startsWith('sudo zfs create')) return { code: 0, stdout: '', stderr: '' };
    if (command.startsWith('testparm ')) return { code: 0, stdout: osDisk, stderr: '' };
    return remoteCommand(command);
  });
  mocks.spawn.mockImplementation((command: string, args: string[]) => {
    const proc = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(),
    });
    const source = command === 'rsync'
      ? args[args.length - 2].substring(args[args.length - 2].indexOf(':') + 1)
      : storage + args[0].substring(2).replace(/\\/g, '/');
    const destination = command === 'rsync' ? args[args.length - 1] : args[1];
    fs.cpSync(source, destination, { recursive: true });
    process.nextTick(() => proc.emit('close', 0));
    return proc;
  });
});

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  vi.restoreAllMocks();
  fs.rmSync(fixture, { recursive: true, force: true });
});

// These suites execute the Linux server program locally, not through SSH.
describe.skipIf(originalPlatform !== 'linux')('remote filesystem validation', () => {
  it.each(['relative/path', '', 'C:\\Downloads'])('rejects non-absolute server path %s', (destination) => {
    const result = runStorage('prepare', destination);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('absolute server path');
  });

  it('rejects OS storage before mkdir or copying', () => {
    const destination = path.join(osDisk, 'restored/nested');
    const result = runStorage('run', destination, 'printf bad > copied');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('mounted, writable ZFS');
    expect(fs.existsSync(path.join(osDisk, 'restored'))).toBe(false);
  });

  it('rejects an unmounted dataset directory, even when it still exists', () => {
    fs.mkdirSync(path.join(fixture, 'unmounted'));
    const result = runStorage('prepare', path.join(fixture, 'unmounted/restored'));
    expect(result.status).toBe(1);
    expect(fs.existsSync(path.join(fixture, 'unmounted/restored'))).toBe(false);
  });

  it('rejects a stale mount table entry whose device no longer matches', () => {
    mountinfo = mount('/', 'ext4', '/dev/os') + mount(storage, 'zfs', 'pool/data', 'rw', '255:255');
    expect(runStorage('prepare', path.join(storage, 'new')).status).toBe(1);
    expect(fs.existsSync(path.join(storage, 'new'))).toBe(false);
  });

  it('rejects symlinks to OS storage, including missing targets', () => {
    fs.symlinkSync(osDisk, path.join(storage, 'escape'));
    fs.symlinkSync(path.join(osDisk, 'missing'), path.join(storage, 'dangling'));
    for (const name of ['escape', 'dangling']) {
      expect(runStorage('prepare', path.join(storage, name, 'new')).status).toBe(1);
    }
    expect(fs.readdirSync(osDisk)).toEqual([]);
  });

  it('rejects an existing destination containing a symlink or submount to OS storage', () => {
    const destination = path.join(storage, 'restored');
    fs.mkdirSync(destination);
    fs.symlinkSync(osDisk, path.join(destination, 'escape'));
    expect(runStorage('run', destination, 'printf bad > copied').status).toBe(1);
    fs.unlinkSync(path.join(destination, 'escape'));
    const nestedMount = path.join(destination, 'os-mount');
    fs.mkdirSync(nestedMount);
    mountinfo += mount(nestedMount, 'ext4', '/dev/other');
    expect(runStorage('run', destination, 'printf bad > copied').status).toBe(1);
    expect(fs.existsSync(path.join(destination, 'copied'))).toBe(false);
  });

  it('rejects read-only ZFS and the root filesystem even when root is ZFS', () => {
    mountinfo = mount('/', 'zfs', 'rpool/ROOT') + mount(storage, 'zfs', 'pool/data', 'ro');
    expect(runStorage('prepare', '/restored').status).toBe(1);
    expect(runStorage('prepare', path.join(storage, 'new')).status).toBe(1);
    expect(runStorage('list').status).toBe(1);
  });

  it('accepts nested directories and symlinks resolving to mounted ZFS outside /tank', () => {
    const destination = path.join(storage, 'nested/new');
    const link = path.join(fixture, 'zfs-link');
    fs.symlinkSync(storage, link);
    const result = runStorage('prepare', path.join(link, 'nested/new'));
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toBe(destination);
    expect(fs.statSync(destination).isDirectory()).toBe(true);
    expect(runStorage('run', destination, 'printf restored > copied').status).toBe(0);
    expect(fs.readFileSync(path.join(destination, 'copied'), 'utf8')).toBe('restored');
  });

  it('discovers actual mounted ZFS datasets with escaped mountpoints, not configured directories', () => {
    fs.mkdirSync(path.join(fixture, 'unmounted'));
    const result = runStorage('list');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([{
      name: 'pool/data', mountpoint: storage, available: expect.any(Number),
    }]);
  });

  it('fails closed without ZFS instead of offering /tmp', () => {
    mountinfo = mount('/', 'ext4', '/dev/os');
    const result = runStorage('list');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('No mounted, writable ZFS');
  });

  it('pins the copy cwd and TMPDIR to validated storage', () => {
    const destination = path.join(storage, 'new');
    const result = runStorage('run', destination, 'printf "%s" "$TMPDIR" > temp-location');
    expect(result.status).toBe(0);
    expect(fs.readFileSync(path.join(destination, 'temp-location'), 'utf8')).toBe('.');
    expect(serverRestoreCommand(destination, 'rsync source ./')).toContain("'run'");
  });

  it('allows an explicitly opted-in custom destination, but never relative or read-only paths', () => {
    const destination = path.join(osDisk, 'restored');
    expect(runStorage('run-custom', destination, 'printf custom > copied').status).toBe(0);
    expect(fs.readFileSync(path.join(destination, 'copied'), 'utf8')).toBe('custom');
    expect(runStorage('prepare-custom', 'relative/path').status).toBe(1);
    mountinfo = mount('/', 'ext4', '/dev/os', 'ro');
    expect(runStorage('prepare-custom', path.join(osDisk, 'readonly')).status).toBe(1);
    expect(fs.existsSync(path.join(osDisk, 'readonly'))).toBe(false);
  });

  it('rejects an interrupted validation response, rather than treating null as success', async () => {
    mocks.execCommand.mockResolvedValueOnce({ code: null, stdout: '', stderr: '' });
    await expect(listRestoreDestinations(host, user)).rejects.toThrow('Cannot validate restore storage');
  });
});

const host = 'server.example';
const user = 'testuser';
const remote = ['backup.example', 22, 'backupuser'] as const;

describe.skipIf(originalPlatform !== 'linux')('main-process restore enforcement', () => {
  const customRestores = [
    ['cloud', (dest: string) => restoreToServer(host, user, 'cloud:', '/backup', dest, undefined, undefined, undefined, true)],
    ['original-location', (dest: string) => restoreToServer(host, user, 'server', '/original', dest, undefined, undefined, undefined, true)],
    ['S2S', (dest: string) => restoreFromS2S(host, user, ...remote, '/backup', dest, undefined, undefined, undefined, true)],
    ['snapshot', (dest: string) => restoreFromSnapshot(host, user, 'pool/data', 'snap', ['file'], dest, true)],
    ['directory creation', (dest: string) => createServerDirectory(host, user, dest, true)],
  ] as const;

  it.each(customRestores)('%s allows final OS destinations only with explicit opt-in', async (label, restore) => {
    mountinfo = mount('/', 'ext4', '/dev/os');
    const destination = path.join(osDisk, 'custom/restored');
    expect(await restore(destination)).toMatchObject({ success: true });
    expect(fs.statSync(destination).isDirectory()).toBe(true);
    if (label !== 'directory creation') {
      expect(fs.readFileSync(path.join(destination, 'restored.txt'), 'utf8')).toBe('restored');
    }
    expect(await restore('relative/path')).toMatchObject({ success: false });
  });

  it.each(customRestores)('%s resolves custom symlinks before writing', async (_label, restore) => {
    fs.symlinkSync(osDisk, path.join(storage, 'custom'));
    expect(await restore(path.join(storage, 'custom/restored'))).toMatchObject({ success: true });
    expect(fs.statSync(path.join(osDisk, 'restored')).isDirectory()).toBe(true);
  });

  const serverRestores = [
    ['cloud', (dest: string) => restoreToServer(host, user, 'cloud:', '/backup', dest)],
    ['server/original-location', (dest: string) => restoreToServer(host, user, 'server', '/original', dest)],
    ['S2S/original-location', (dest: string) => restoreFromS2S(host, user, ...remote, '/backup', dest)],
    ['snapshot', (dest: string) => restoreFromSnapshot(host, user, 'pool/data', 'snap', ['file'], dest)],
    ['directory creation', (dest: string) => createServerDirectory(host, user, dest)],
    ['dataset creation', (dest: string) => createZfsDatasetOnServer(host, user, 'pool/new', dest)],
  ] as const;

  it.each(serverRestores)('%s rejects OS and relative destinations before writing', async (_label, restore) => {
    for (const dest of [path.join(osDisk, 'restored'), 'relative/path']) {
      const result = await restore(dest);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Restore storage validation failed');
    }
    expect(fs.readdirSync(osDisk)).toEqual([]);
    expect(mocks.execCommand.mock.calls.some(([cmd]) => cmd.startsWith('sudo zfs create'))).toBe(false);
    expect(mocks.dispose).toHaveBeenCalled();
  });

  it.each(serverRestores)('%s accepts mounted ZFS nested destinations', async (label, restore) => {
    const dest = path.join(storage, 'nested/restored');
    const result = await restore(dest);
    expect(result).toMatchObject({ success: true });
    if (label !== 'dataset creation' && label !== 'directory creation') {
      expect(fs.readFileSync(path.join(dest, 'restored.txt'), 'utf8')).toBe('restored');
    }
  });

  it.each(serverRestores)('%s rejects a symlink leading to OS storage', async (_label, restore) => {
    fs.symlinkSync(osDisk, path.join(storage, 'escape'));
    const result = await restore(path.join(storage, 'escape/restored'));
    expect(result.success).toBe(false);
    expect(fs.readdirSync(osDisk)).toEqual([]);
  });

  it.each(serverRestores)('%s rejects an unmounted dataset directory', async (_label, restore) => {
    const unmounted = path.join(fixture, 'unmounted');
    fs.mkdirSync(unmounted);
    const result = await restore(path.join(unmounted, 'new'));
    expect(result.success).toBe(false);
    expect(fs.readdirSync(unmounted)).toEqual([]);
  });

  it('derives and validates the inherited mountpoint for dataset creation without a supplied path', async () => {
    mocks.execCommand.mockResolvedValueOnce({ code: 0, stdout: osDisk, stderr: '' });
    expect(await createZfsDatasetOnServer(host, user, 'pool/new')).toMatchObject({ success: false });
    expect(mocks.execCommand.mock.calls.some(([cmd]) => cmd.startsWith('sudo zfs create'))).toBe(false);
  });

  it('discovers mounted restore destinations through the main-process entry point', async () => {
    expect(await listRestoreDestinations(host, user)).toEqual([
      { name: 'pool/data', mountpoint: storage, available: expect.any(Number) },
    ]);
  });

  const clientRestores = [
    ['cloud download', (dest: string) => restoreToClient(host, user, 'cloud:', '/backup', dest)],
    ['server download', (dest: string) => restoreToClient(host, user, 'server', '/backup', dest)],
    ['S2S download', (dest: string) => restoreS2SToClient(host, user, ...remote, '/backup', dest)],
  ] as const;

  it.each(clientRestores)('%s rejects unavailable ZFS staging, with no /tmp fallback', async (_label, restore) => {
    mountinfo = mount('/', 'ext4', '/dev/os');
    const result = await restore(path.join(osDisk, 'client-download'));
    expect(result.success).toBe(false);
    expect(result.error).toContain('No mounted, writable ZFS');
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(fs.readdirSync(osDisk)).toEqual([]);
  });

  it.each(clientRestores)('%s rejects staging symlinks to OS storage', async (_label, restore) => {
    fs.symlinkSync(osDisk, path.join(storage, '.houston-restore-staging'));
    const result = await restore(path.join(osDisk, 'client-download'));
    expect(result.success).toBe(false);
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(fs.readdirSync(osDisk)).toEqual([]);
  });

  it.each(clientRestores)('%s stages on ZFS but still allows a client-local OS folder', async (_label, restore) => {
    const local = path.join(osDisk, 'client-download');
    const result = await restore(local);
    expect(result).toMatchObject({ success: true });
    expect(fs.statSync(local).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(local, 'restored.txt'), 'utf8')).toBe('restored');
    const [command, args] = mocks.spawn.mock.calls[0];
    expect(command).toBe('rsync');
    expect(args).toContain(`${local}/`);
    expect(args.some((arg: string) => arg.includes(`${storage}/.houston-restore-staging/`))).toBe(true);
    expect(fs.readdirSync(path.join(storage, '.houston-restore-staging'))).toEqual([]);
  });

  it('rejects Windows SMB staging on OS storage before copying there', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    mocks.credentials.mockReturnValue([{ share: 'backup' }]);
    mocks.credential.mockReturnValue({ share: 'backup', username: 'smbuser', password: 'test-fixture' });
    const result = await restoreToClient(host, user, 'cloud:', '/backup', path.join(fixture, 'client'));
    expect(result.success).toBe(false);
    expect(result.error).toContain('mounted, writable ZFS');
    expect(fs.readdirSync(osDisk)).toEqual([]);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('still downloads to a Windows client folder when SMB staging is on mounted ZFS', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    mocks.credentials.mockReturnValue([{ share: 'backup' }]);
    mocks.credential.mockReturnValue({ share: 'backup', username: 'smbuser', password: 'test-fixture' });
    const execute = mocks.execCommand.getMockImplementation()!;
    mocks.execCommand.mockImplementation(async (command: string) => command.startsWith('testparm ')
      ? { code: 0, stdout: storage, stderr: '' }
      : execute(command));
    const local = path.join(osDisk, 'client-download');
    expect(await restoreToClient(host, user, 'cloud:', '/backup', local)).toMatchObject({ success: true });
    expect(mocks.spawn.mock.calls[0][0]).toBe('robocopy');
    expect(fs.readFileSync(path.join(local, 'restored.txt'), 'utf8')).toBe('restored');
  });

  it('rechecks staging if a mount disappears after discovery', async () => {
    const execute = mocks.execCommand.getMockImplementation()!;
    mocks.execCommand.mockImplementation(async (command: string) => {
      const result = await execute(command);
      if (command.endsWith(" 'list'")) mountinfo = mount('/', 'ext4', '/dev/os');
      return result;
    });
    const result = await restoreToClient(host, user, 'cloud:', '/backup', path.join(osDisk, 'download'));
    expect(result.success).toBe(false);
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(storage, '.houston-restore-staging'))).toBe(false);
  });

  it('rechecks storage before copying if a mount disappears after staging preparation', async () => {
    const execute = mocks.execCommand.getMockImplementation()!;
    mocks.execCommand.mockImplementation(async (command: string) => {
      const result = await execute(command);
      if (command.includes(`${shellQuote(restoreStorageScript)} 'prepare' `)) {
        mountinfo = mount('/', 'ext4', '/dev/os');
      }
      return result;
    });
    const result = await restoreS2SToClient(host, user, ...remote, '/backup', path.join(osDisk, 'download'));
    expect(result.success).toBe(false);
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(fs.readdirSync(osDisk)).toEqual([]);
  });
});
