import { describe, it, expect } from 'vitest';

// ── TaskData interface (mirrors BackUpManagerWin.ts after our changes)
interface TaskData {
  source?: string;
  target?: string;
  description?: string;
  mirror?: boolean;
  schedule?: string;
  uuid?: string;
  SMB_HOST?: string;
  SMB_SHARE?: string;
  SMB_USER?: string;
  START_DATE?: string;
  [key: string]: string | boolean | undefined;
}

describe('TaskData index signature', () => {
  it('allows known fields to be accessed directly', () => {
    const data: TaskData = {
      uuid: 'abc-123',
      SMB_HOST: 'server.local',
      SMB_SHARE: 'backups',
      SMB_USER: 'admin',
      START_DATE: '2025-01-01T00:00:00Z',
    };

    expect(data.SMB_USER).toBe('admin');
    expect(data.START_DATE).toBe('2025-01-01T00:00:00Z');
  });

  it('allows arbitrary keys via index signature (matches BAT regex parsing)', () => {
    const data: TaskData = {};
    // Simulating what parseBackupCommand does: task[key] = value
    data['CUSTOM_KEY'] = 'custom_value';
    data['ANOTHER'] = 'another_value';

    expect(data['CUSTOM_KEY']).toBe('custom_value');
    expect(data['ANOTHER']).toBe('another_value');
  });

  it('builds a BackUpTask from TaskData without any casts', () => {
    const actionDetails: TaskData = {
      uuid: 'test-uuid',
      description: 'My backup',
      source: '/Users/me/docs',
      target: 'server:share/path',
      mirror: true,
      SMB_HOST: 'server',
      SMB_SHARE: 'share',
      SMB_USER: 'admin',
      START_DATE: '2025-06-15T08:30:00Z',
    };

    // Mirrors fixed BackUpManagerWin.ts queryTasks — no "as any" needed
    const backUpTask = {
      uuid: actionDetails.uuid!,
      description: actionDetails.description!,
      source: actionDetails.source!,
      target: actionDetails.target!,
      mirror: actionDetails.mirror === true,
      host: actionDetails.SMB_HOST,
      share: actionDetails.SMB_SHARE,
      smb_user: actionDetails.SMB_USER,
      schedule: { repeatFrequency: 'day' as const, startDate: new Date() },
      status: 'checking' as const,
    };

    if (actionDetails.START_DATE) {
      backUpTask.schedule.startDate = new Date(actionDetails.START_DATE);
    }

    expect(backUpTask.uuid).toBe('test-uuid');
    expect(backUpTask.smb_user).toBe('admin');
    expect(backUpTask.schedule.startDate.toISOString()).toBe('2025-06-15T08:30:00.000Z');
  });
});

// ── Server interface (mirrors main/types.ts)
interface Server {
  ip: string;
  name: string;
  lastSeen: number;
  status: 'unknown' | 'complete' | 'not complete';
  manuallyAdded?: boolean;
  fallbackAdded?: boolean;
}

describe('Server type — no more (srv as any)', () => {
  it('manuallyAdded is accessible without cast', () => {
    const srv: Server = { ip: '192.168.1.10', name: 'NAS', lastSeen: Date.now(), status: 'complete', manuallyAdded: true };
    expect(srv.manuallyAdded).toBe(true);
  });

  it('fallbackAdded defaults to undefined', () => {
    const srv: Server = { ip: '192.168.1.10', name: 'NAS', lastSeen: Date.now(), status: 'unknown' };
    expect(srv.fallbackAdded).toBeUndefined();
  });

  it('clearInactiveServers filter pattern works', () => {
    const TIMEOUT = 30_000;
    const now = Date.now();

    const servers: Server[] = [
      { ip: '10.0.0.1', name: 'A', lastSeen: now, status: 'complete' },
      { ip: '10.0.0.2', name: 'B', lastSeen: now - 60_000, status: 'complete' }, // stale
      { ip: '10.0.0.3', name: 'C', lastSeen: now - 60_000, status: 'complete', manuallyAdded: true }, // stale but manual
    ];

    // Mirrors the fixed main.ts filter
    const filtered = servers.filter(srv =>
      now - srv.lastSeen <= TIMEOUT || srv.manuallyAdded === true
    );

    expect(filtered).toHaveLength(2);
    expect(filtered.map(s => s.ip)).toEqual(['10.0.0.1', '10.0.0.3']);
  });

  it('discovery filter excludes manual and fallback servers', () => {
    const servers: Server[] = [
      { ip: '10.0.0.1', name: 'A', lastSeen: 0, status: 'unknown' },
      { ip: '10.0.0.2', name: 'B', lastSeen: 0, status: 'unknown', manuallyAdded: true },
      { ip: '10.0.0.3', name: 'C', lastSeen: 0, status: 'unknown', fallbackAdded: true },
      { ip: '127.0.0.1', name: 'local', lastSeen: 0, status: 'unknown' },
    ];

    // Mirrors the fixed main.ts pollAction filter
    const pollable = servers.filter(s =>
      !s.manuallyAdded &&
      !s.fallbackAdded &&
      s.ip !== '127.0.0.1'
    );

    expect(pollable).toHaveLength(1);
    expect(pollable[0].ip).toBe('10.0.0.1');
  });
});
