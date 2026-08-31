import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Regression net for the Windows deletion-time cleanup.
 *
 * PowerShell can't be executed here, so these tests assert on the script the
 * manager generates. Each case covers a way credential files could be deleted
 * while a remaining scheduled task still needs them.
 */

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/houston-win-teardown-test' } }));
vi.mock('../main', () => ({ jsonLogger: { log: vi.fn(), error: vi.fn() } }));
vi.mock('../credentialManager', () => ({ getCredentialManager: () => ({}) }));
vi.mock('sudo-prompt', () => {
  const mod = { exec: vi.fn() };
  return { ...mod, default: mod };
});
vi.mock('./broadcasterApi', () => ({
  syncBackupConfig: vi.fn(),
  getClientId: () => 'test-client',
  batchEventSnippet: () => '',
}));
vi.mock('../utils', () => ({
  formatDateForTask: () => '2025-01-01T03:00:00',
  getAppPath: () => '/tmp',
  getMountSmbScript: () => '',
  getSmbTargetFromSmbTarget: (t: string) => t,
}));
vi.mock('child_process', () => {
  const mod = { exec: vi.fn() };
  return { ...mod, default: mod };
});

import { BackUpManagerWin } from './BackUpManagerWin';

type AnyTask = any;

function task(over: Partial<AnyTask> = {}): AnyTask {
  return {
    uuid: 'uuid-' + Math.random().toString(16).slice(2),
    description: 'test',
    source: 'C:\\Users\\tester\\docs',
    target: 'nas.local:media/backup',
    mirror: false,
    schedule: { repeatFrequency: 'day', startDate: new Date('2025-01-01T03:00:00Z') },
    host: 'nas.local',
    share: 'media',
    smb_user: 'tester',
    ...over,
  };
}

/** Captures the PowerShell produced by unschedule / unscheduleSelectedTasks. */
async function psFor(run: (mgr: any) => Promise<void>): Promise<string> {
  const mgr: any = new BackUpManagerWin();
  let captured = '';
  vi.spyOn(mgr, 'runScript').mockImplementation(async (ps: unknown) => {
    captured = String(ps);
    return { stdout: '', stderr: '' };
  });
  await run(mgr);
  return captured;
}

describe('BackUpManagerWin unschedule cleanup guards', () => {
  afterEach(() => vi.restoreAllMocks());

  it('marks the credential as in use up front when the task has no smb user', async () => {
    const ps = await psFor(m => m.unschedule(task({ smb_user: '' })));
    expect(ps).toContain('$credInUse = $true');
    expect(ps).not.toContain('$credInUse = $false');
  });

  it('considers the credential removable only when an smb user is recorded', async () => {
    const ps = await psFor(m => m.unschedule(task()));
    expect(ps).toContain('$credInUse = $false');
    expect(ps).toContain('nas.local_media_tester.cred');
  });

  it('fails the enumeration loudly rather than treating every credential as unused', async () => {
    const ps = await psFor(m => m.unschedule(task()));
    expect(ps).toMatch(/Get-ChildItem[^\n]*-ErrorAction Stop/);
    expect(ps).toMatch(/catch\s*{[^}]*\$credInUse = \$true[^}]*}/);
  });

  it('deletes the credential only behind the in-use check', async () => {
    const ps = await psFor(m => m.unschedule(task()));
    expect(ps).toMatch(/if \(-not \$credInUse\) {\s*Remove-Item -Path \$credPath/);
  });
});

describe('BackUpManagerWin bulk unschedule cleanup guards', () => {
  afterEach(() => vi.restoreAllMocks());

  it('excludes tasks with no smb user from the credential list', async () => {
    const ps = await psFor(m => m.unscheduleSelectedTasks([task({ smb_user: '' })]));
    expect(ps).toContain('$CredPaths = @()');
  });

  it('deduplicates credentials shared by several deleted tasks', async () => {
    const ps = await psFor(m => m.unscheduleSelectedTasks([task(), task()]));
    const creds = /\$CredPaths\s+= @\((.*)\)/.exec(ps)![1];
    expect(creds.split(',')).toHaveLength(1);
  });

  it('keeps distinct credentials separate', async () => {
    const ps = await psFor(m =>
      m.unscheduleSelectedTasks([task(), task({ share: 'archive', target: 'nas.local:archive/backup' })])
    );
    const creds = /\$CredPaths\s+= @\((.*)\)/.exec(ps)![1];
    expect(creds.split(',')).toHaveLength(2);
  });

  it('aborts the sweep if the remaining tasks cannot be enumerated', async () => {
    const ps = await psFor(m => m.unscheduleSelectedTasks([task()]));
    expect(ps).toMatch(/\$remainingBats = @\(Get-ChildItem[^\n]*-ErrorAction Stop\)/);
  });

  it('deletes each credential only behind its own in-use check', async () => {
    const ps = await psFor(m => m.unscheduleSelectedTasks([task()]));
    expect(ps).toMatch(/if \(-not \$inUse\) {[^}]*Remove-Item -Path \$credPath/);
  });
});
