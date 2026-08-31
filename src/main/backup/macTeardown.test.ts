import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';

/**
 * Regression net for the macOS deletion-time teardown.
 *
 * The real teardown only runs on a Mac, so these tests exercise the decision
 * logic and assert on the privileged script it generates rather than running it.
 * Every guard here corresponds to a way credentials could be destroyed for a
 * share the user still wants.
 */

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/houston-mac-teardown-test' } }));
vi.mock('../main', () => ({ jsonLogger: { log: vi.fn(), error: vi.fn() } }));
vi.mock('../credentialManager', () => ({ getCredentialManager: () => ({}) }));
vi.mock('./broadcasterApi', () => ({
  syncBackupConfig: vi.fn(),
  getClientId: () => 'test-client',
  bashEventSnippetMac: () => '',
}));
vi.mock('../utils', () => ({
  getRsync: () => 'rsync',
  getSmbTargetFromSmbTarget: (t: string) => t,
}));
vi.mock('child_process', () => {
  const mod = { execSync: vi.fn(() => ''), spawn: vi.fn() };
  return { ...mod, default: mod };
});

import { BackUpManagerMac } from './BackUpManagerMac';

type AnyTask = any;

function task(over: Partial<AnyTask> = {}): AnyTask {
  return {
    uuid: 'uuid-' + Math.random().toString(16).slice(2),
    description: 'test',
    source: '/Users/tester/docs',
    target: 'nas.local:media/backup',
    mirror: false,
    schedule: { repeatFrequency: 'day', startDate: new Date('2025-01-01T03:00:00Z') },
    host: 'nas.local',
    share: 'media',
    smb_user: 'tester',
    ...over,
  };
}

/**
 * Runs teardown and returns the privileged script it produced, or null if it
 * decided nothing was safe to remove.
 */
async function teardownScript(
  removed: AnyTask[],
  opts: { remaining?: AnyTask[]; mounted?: Set<string> | null; queryFails?: boolean } = {}
): Promise<string | null> {
  const mgr: any = new BackUpManagerMac();

  vi.spyOn(mgr, 'queryTasks').mockImplementation(async () => {
    if (opts.queryFails) throw new Error('crontab unavailable');
    return opts.remaining ?? [];
  });
  vi.spyOn(mgr, 'mountedVolumeNames').mockReturnValue(
    opts.mounted === undefined ? new Set<string>() : opts.mounted
  );

  let captured: string | null = null;
  vi.spyOn(mgr, 'runAsAdmin').mockImplementation((cmd: unknown) => {
    const m = /^bash '(.+)'$/.exec(String(cmd));
    // Read before teardown's finally block unlinks it.
    if (m) captured = fs.readFileSync(m[1], 'utf8');
  });

  await mgr.teardownUnusedMounts(removed);
  return captured;
}

describe('BackUpManagerMac teardown guards', () => {
  afterEach(() => vi.restoreAllMocks());

  it('removes credentials and the mount link for the last task using a share', async () => {
    const script = await teardownScript([task()]);
    expect(script).toContain("security delete-generic-password -s 'houston-smb-nas.local-media-tester'");
    expect(script).toContain("security delete-internet-password -s 'nas.local'");
    expect(script).toMatch(/rm -f '.*\/houston-mounts\/media'/);
  });

  it('does nothing when another task still uses the same share', async () => {
    const script = await teardownScript([task()], { remaining: [task()] });
    expect(script).toBeNull();
  });

  it('keeps the host credential when another share on that host remains', async () => {
    const script = await teardownScript([task({ share: 'media' })], {
      remaining: [task({ share: 'archive' })],
    });
    expect(script).toContain('delete-generic-password');
    expect(script).not.toContain('delete-internet-password');
  });

  it('never removes the mount link while the volume is mounted', async () => {
    const script = await teardownScript([task()], { mounted: new Set(['media']) });
    expect(script).toContain('delete-generic-password');
    expect(script).not.toContain('houston-mounts/media');
  });

  it('leaves the mount link alone when mount state cannot be determined', async () => {
    const script = await teardownScript([task()], { mounted: null });
    expect(script).not.toContain('houston-mounts/media');
  });

  it('aborts entirely when remaining tasks cannot be listed', async () => {
    expect(await teardownScript([task()], { queryFails: true })).toBeNull();
  });

  it('skips entries whose host, share or user contain unexpected characters', async () => {
    const script = await teardownScript([task({ share: 'media; rm -rf /' })]);
    expect(script).toBeNull();
  });

  it('skips tasks with no recorded smb user', async () => {
    expect(await teardownScript([task({ smb_user: '' })])).toBeNull();
  });

  it('deduplicates repeated host/share/user combinations', async () => {
    const script = await teardownScript([task(), task()]);
    expect(script!.match(/delete-generic-password/g)).toHaveLength(1);
  });

  it('updateSchedule does not tear down the task it is re-creating', async () => {
    const mgr: any = new BackUpManagerMac();
    const teardown = vi.spyOn(mgr, 'teardownUnusedMounts');
    vi.spyOn(mgr, 'schedule').mockResolvedValue({ stdout: '', stderr: '' });
    vi.spyOn(mgr, 'applyCleanedCrontab').mockImplementation(() => {});

    await mgr.updateSchedule(task(), 'tester', 'pw');

    expect(teardown).not.toHaveBeenCalled();
  });
});
