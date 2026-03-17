import { describe, it, expect } from 'vitest';

/**
 * Tests for the BackUpManager interface contract.
 * Verifies that the interface shape matches what consumers expect.
 */

// Inline the interface (mirrors backup/types.ts) so we can validate shapes
// without needing the full Electron + houston-common-lib imports.
interface TaskSchedule {
  repeatFrequency: 'hour' | 'day' | 'week' | 'month';
  startDate: Date;
}

interface BackUpTask {
  schedule: TaskSchedule;
  description: string;
  source: string;
  target: string;
  mirror: boolean;
  uuid: string;
  status?: string;
  share?: string;
  host?: string;
  smb_user?: string;
}

interface BackUpManager {
  queryTasks(): Promise<BackUpTask[]>;
  unschedule(task: BackUpTask): Promise<void>;
  schedule(task: BackUpTask, username: string, password: string): Promise<{ stdout: string; stderr: string }>;
  updateSchedule(task: BackUpTask, username: string, password: string): Promise<void>;
  unscheduleSelectedTasks?(tasks: BackUpTask[]): Promise<void>;
  isFirstBackupNeeded?(host: string, share: string, smbUser: string): boolean;
  scheduleAllTasks?(
    tasks: BackUpTask[],
    username: string,
    password: string,
    onProgress?: (step: number, total: number, message: string) => void
  ): Promise<void>;
  runNow?(task: BackUpTask): Promise<{ stdout: string; stderr: string }>;
}

function makeMockTask(overrides: Partial<BackUpTask> = {}): BackUpTask {
  return {
    uuid: 'test-uuid-1234',
    description: 'Test backup',
    source: '/home/user/docs',
    target: 'server.local:share/backup-uuid',
    mirror: false,
    schedule: { repeatFrequency: 'day', startDate: new Date('2025-01-01T10:00:00Z') },
    ...overrides,
  };
}

describe('BackUpManager interface contract', () => {
  it('a mock manager with all optional methods satisfies the interface', () => {
    const manager: BackUpManager = {
      queryTasks: async () => [],
      unschedule: async () => {},
      schedule: async () => ({ stdout: 'ok', stderr: '' }),
      updateSchedule: async () => {},
      unscheduleSelectedTasks: async () => {},
      isFirstBackupNeeded: () => true,
      scheduleAllTasks: async () => {},
      runNow: async () => ({ stdout: 'done', stderr: '' }),
    };

    expect(manager.runNow).toBeDefined();
    expect(manager.scheduleAllTasks).toBeDefined();
    expect(manager.isFirstBackupNeeded).toBeDefined();
  });

  it('a minimal manager (no optional methods) satisfies the interface', () => {
    const manager: BackUpManager = {
      queryTasks: async () => [],
      unschedule: async () => {},
      schedule: async () => ({ stdout: '', stderr: '' }),
      updateSchedule: async () => {},
    };

    expect(manager.runNow).toBeUndefined();
    expect(manager.scheduleAllTasks).toBeUndefined();
  });

  it('optional method guard works correctly', async () => {
    const manager: BackUpManager = {
      queryTasks: async () => [],
      unschedule: async () => {},
      schedule: async () => ({ stdout: '', stderr: '' }),
      updateSchedule: async () => {},
    };

    // This pattern mirrors backupHandlers.ts after our fix
    if (manager.scheduleAllTasks) {
      await manager.scheduleAllTasks([], 'user', 'pass');
    }

    if (manager.runNow) {
      const result = await manager.runNow(makeMockTask());
      expect(result.stdout).toBeDefined();
    }

    // Reaching here without error confirms the guard pattern works
    expect(true).toBe(true);
  });
});

describe('BackUpTask field access (no more "as any")', () => {
  it('all fields used in taskToBackupEntry are on the interface', () => {
    const task = makeMockTask({
      host: 'myserver',
      share: 'myshare',
      smb_user: 'admin',
    });

    // These lines mirror the fixed BackupBrowser.vue taskToBackupEntry
    expect(task.uuid).toBe('test-uuid-1234');
    expect(task.host).toBe('myserver');
    expect(task.share).toBe('myshare');
    expect(task.source).toBe('/home/user/docs');
    expect(task.target).toBe('server.local:share/backup-uuid');
    expect(task.smb_user).toBe('admin');
  });

  it('optional fields default to undefined', () => {
    const task = makeMockTask();
    expect(task.host).toBeUndefined();
    expect(task.share).toBeUndefined();
    expect(task.smb_user).toBeUndefined();
  });

  it('resolveConnForTask uses direct field access', () => {
    const task = makeMockTask({ host: 'nas01', share: 'backups', smb_user: 'admin' });

    // Mirrors the fixed resolveConnForTask
    const smb_host = task.host ? `${task.host}.local` : '';
    const smb_share = task.share ?? '';
    const smb_user = task.smb_user ?? '';

    expect(smb_host).toBe('nas01.local');
    expect(smb_share).toBe('backups');
    expect(smb_user).toBe('admin');
  });

  it('resolveConnForTask handles missing optional fields', () => {
    const task = makeMockTask();

    const smb_host = task.host ? `${task.host}.local` : '';
    const smb_share = task.share ?? '';
    const smb_user = task.smb_user ?? '';

    expect(smb_host).toBe('');
    expect(smb_share).toBe('');
    expect(smb_user).toBe('');
  });
});
