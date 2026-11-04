// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeSSH } from 'node-ssh';
import { shellQuote } from './security';
import {
  listMountedRestoreDestinations, prepareServerRestoreDirectory,
  restoreStorageScript, serverRestoreCommand, validateServerRestoreDestination,
} from './restoreStorage';

const mocks = vi.hoisted(() => ({
  execCommand: vi.fn(),
  dispose: vi.fn(),
  spawn: vi.fn(() => { throw new Error('Tests must not launch local transfer processes'); }),
}));

vi.mock('./sshPool', () => ({
  acquireSSH: vi.fn(async () => ({ execCommand: mocks.execCommand, dispose: mocks.dispose })),
}));
vi.mock('./setupSsh', () => ({}));
vi.mock('./crossPlatformSsh', () => ({}));
vi.mock('./settingsStore', () => ({ loadSettings: () => ({}) }));
vi.mock('./credentialManager', () => ({
  getCredentialManager: () => ({ getForHost: () => undefined }),
}));
vi.mock('./utils', () => ({}));
vi.mock('./logging', () => ({
  errMsg: (error: unknown) => error instanceof Error ? error.message : String(error),
  logEvent: vi.fn(),
}));
vi.mock('child_process', () => ({
  spawn: mocks.spawn,
  execSync: vi.fn(() => { throw new Error('Tests must not launch local shell commands'); }),
}));

import {
  createServerDirectory, createZfsDatasetOnServer, listRestoreDestinations,
  restoreFromS2S, restoreFromSnapshot, restoreS2SToClient, restoreToClient, restoreToServer,
} from './restoreManager';

const host = 'server.example';
const user = 'testuser';
const destination = "/mnt/data with spaces/restored's";
const remote = ['backup.example', 22, 'backupuser'] as const;
const storagePrefix = `python3 -c ${shellQuote(restoreStorageScript)}`;
const failure = 'Restore storage validation failed: destination is not on mounted ZFS data storage';

function command(mode: string, args: string[] = []) {
  return `${storagePrefix} ${[mode, ...args].map(shellQuote).join(' ')}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.execCommand.mockResolvedValue({ code: 1, stdout: '', stderr: failure });
});

describe('restore storage SSH protocol (all client platforms)', () => {
  it('discovers mounted storage remotely, with no local Linux prerequisites', async () => {
    const ssh = new NodeSSH();
    const destinations = [{ name: 'pool/data', mountpoint: '/srv/data', available: 12345 }];
    const exec = vi.spyOn(ssh, 'execCommand').mockResolvedValue({
      code: 0, stdout: JSON.stringify(destinations), stderr: '', signal: null,
    });
    expect(await listMountedRestoreDestinations(ssh)).toEqual(destinations);
    expect(exec).toHaveBeenCalledExactlyOnceWith(command('list'));
  });

  it.each([
    ['validation', 'validate', (ssh: NodeSSH) => validateServerRestoreDestination(ssh, destination)],
    ['directory creation', 'prepare', (ssh: NodeSSH) => prepareServerRestoreDirectory(ssh, destination)],
    ['custom directory creation', 'prepare-custom', (ssh: NodeSSH) => prepareServerRestoreDirectory(ssh, destination, true)],
  ] as const)('quotes %s paths for the server shell, not the client OS', async (_label, mode, invoke) => {
    const ssh = new NodeSSH();
    const exec = vi.spyOn(ssh, 'execCommand').mockResolvedValue({
      code: 0, stdout: JSON.stringify(destination), stderr: '', signal: null,
    });
    expect(await invoke(ssh)).toBe(destination);
    expect(exec).toHaveBeenCalledExactlyOnceWith(command(mode, [destination]));
  });

  it.each([1, null])('fails closed on remote exit %s', async (code) => {
    const ssh = new NodeSSH();
    vi.spyOn(ssh, 'execCommand').mockResolvedValue({ code, stdout: '', stderr: failure, signal: null });
    await expect(prepareServerRestoreDirectory(ssh, destination)).rejects.toThrow(failure);
  });

  it.each(['null', '[]', '{}', '[{"name":"pool/data","mountpoint":"relative","available":1}]'])(
    'rejects invalid discovery response %s', async (stdout) => {
      const ssh = new NodeSSH();
      vi.spyOn(ssh, 'execCommand').mockResolvedValue({ code: 0, stdout, stderr: '', signal: null });
      await expect(listMountedRestoreDestinations(ssh)).rejects.toThrow('Invalid mounted ZFS destination response');
    },
  );

  it('keeps strict and opted-in copy commands distinct', () => {
    const copy = 'exec rsync -a /backup/ ./';
    expect(serverRestoreCommand(destination, copy)).toBe(command('run', [destination, copy]));
    expect(serverRestoreCommand(destination, copy, true)).toBe(`sudo ${command('run', [destination, copy])}`);
    expect(serverRestoreCommand(destination, copy, false, true)).toBe(command('run-custom', [destination, copy]));
  });
});

describe('restore execution over mocked SSH (all client platforms)', () => {
  const restores = [
    ['cloud', (custom: boolean) => restoreToServer(host, user, 'cloud:', '/backup', destination, undefined, undefined, undefined, custom)],
    ['original-location', (custom: boolean) => restoreToServer(host, user, 'server', '/original', destination, undefined, undefined, undefined, custom)],
    ['S2S', (custom: boolean) => restoreFromS2S(host, user, ...remote, '/backup', destination, undefined, undefined, undefined, custom)],
    ['snapshot', (custom: boolean) => restoreFromSnapshot(host, user, 'pool/data', 'snap', ['file'], destination, custom)],
    ['directory creation', (custom: boolean) => createServerDirectory(host, user, destination, custom)],
  ] as const;

  function respond(commandText: string) {
    if (commandText.startsWith('zfs get')) return { code: 0, stdout: '/srv/data', stderr: '' };
    if (commandText.startsWith(command('prepare-custom', [destination]))) {
      return { code: 0, stdout: JSON.stringify(destination), stderr: '' };
    }
    if (commandText.includes(`${storagePrefix} 'run-custom' `)) return { code: 0, stdout: '', stderr: '' };
    return { code: 1, stdout: '', stderr: failure };
  }

  it.each(restores)('%s propagates strict storage failures from the server', async (_label, restore) => {
    mocks.execCommand.mockImplementation(async (cmd: string) => respond(cmd));
    expect(await restore(false)).toMatchObject({ success: false, error: failure });
    expect(mocks.execCommand.mock.calls.some(([cmd]) => cmd.includes(storagePrefix))).toBe(true);
    expect(mocks.execCommand.mock.calls.some(([cmd]) => cmd.includes("'run-custom'") || cmd.includes("'prepare-custom'"))).toBe(false);
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it.each(restores)('%s forwards an explicit custom-path opt-in', async (_label, restore) => {
    mocks.execCommand.mockImplementation(async (cmd: string) => respond(cmd));
    expect(await restore(true)).toMatchObject({ success: true });
    expect(mocks.execCommand.mock.calls.some(([cmd]) =>
      cmd.includes("'run-custom'") || cmd.includes("'prepare-custom'"),
    )).toBe(true);
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it('does not create a dataset when destination validation fails', async () => {
    expect(await createZfsDatasetOnServer(host, user, 'pool/new', destination))
      .toMatchObject({ success: false, error: failure });
    expect(mocks.execCommand).toHaveBeenCalledExactlyOnceWith(command('validate', [destination]));
  });

  it('propagates unavailable storage discovery instead of returning fallback paths', async () => {
    await expect(listRestoreDestinations(host, user)).rejects.toThrow(failure);
  });

  const downloads = [
    ['cloud', () => restoreToClient(host, user, 'cloud:', '/backup', 'C:\\Downloads')],
    ['S2S', () => restoreS2SToClient(host, user, ...remote, '/backup', 'C:\\Downloads')],
  ] as const;

  it.each(downloads)('%s download fails before any local transfer when ZFS staging is unavailable', async (_label, restore) => {
    expect(await restore()).toMatchObject({ success: false, error: failure });
    expect(mocks.execCommand.mock.calls.every(([cmd]) => cmd === command('list'))).toBe(true);
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
});
