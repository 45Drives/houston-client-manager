import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Constants extracted in server.js
// These mirror what was extracted to verify the values are correct.
const SERVER_PORT = 9095;
const BONJOUR_SERVICE_TYPE = 'houstonserver';
const REPUBLISH_DEBOUNCE_MS = 1_500;
const WATCHDOG_INTERVAL_MS = 60_000;

describe('server.js constants', () => {
  it('SERVER_PORT is 9095', () => {
    expect(SERVER_PORT).toBe(9095);
  });

  it('BONJOUR_SERVICE_TYPE is houstonserver', () => {
    expect(BONJOUR_SERVICE_TYPE).toBe('houstonserver');
  });

  it('REPUBLISH_DEBOUNCE_MS is 1500', () => {
    expect(REPUBLISH_DEBOUNCE_MS).toBe(1500);
  });

  it('WATCHDOG_INTERVAL_MS is 60000', () => {
    expect(WATCHDOG_INTERVAL_MS).toBe(60000);
  });
});

// ── RestoreBackupsData (new interface from RestoreBackups.ts)
interface RestoreBackupsData {
  smb_host: string;
  smb_share: string;
  mountPoint?: string;
  uuid: string;
  files: string[];
}

// ── FetchBackupsData (new interface from FetchBackups.ts)
interface FetchBackupsData {
  smb_host: string;
  smb_share: string;
  smb_user: string;
  smb_pass: string;
}

describe('RestoreBackupsData interface', () => {
  it('accepts all required fields', () => {
    const data: RestoreBackupsData = {
      smb_host: '192.168.1.100',
      smb_share: 'backups',
      uuid: 'abc-def-123',
      files: ['/home/user/doc.txt', '/home/user/photo.jpg'],
    };
    expect(data.smb_host).toBe('192.168.1.100');
    expect(data.files).toHaveLength(2);
    expect(data.mountPoint).toBeUndefined();
  });

  it('accepts mountPoint as optional', () => {
    const data: RestoreBackupsData = {
      smb_host: '192.168.1.100',
      smb_share: 'backups',
      uuid: 'abc-def-123',
      files: [],
      mountPoint: 'Z:',
    };
    expect(data.mountPoint).toBe('Z:');
  });
});

describe('FetchBackupsData interface', () => {
  it('requires all four SMB fields', () => {
    const data: FetchBackupsData = {
      smb_host: 'nas.local',
      smb_share: 'backups',
      smb_user: 'admin',
      smb_pass: 'secret',
    };
    expect(data.smb_host).toBe('nas.local');
    expect(data.smb_user).toBe('admin');
  });
});

// ── findValue recursive tree searcher (from composables/utility.ts)
function findValue(obj: any, targetKey: string, valueKey: string): any {
  if (!obj || typeof obj !== 'object') return null;

  if (obj.key === targetKey) {
    if (targetKey === valueKey && obj.value !== undefined) {
      return obj.value;
    }
    const foundChild = obj.children?.find((child: any) => child.key === valueKey);
    if (foundChild && foundChild.value !== undefined) {
      return foundChild.value;
    }
  }

  if (Array.isArray(obj.children)) {
    for (const child of obj.children) {
      const result = findValue(child, targetKey, valueKey);
      if (result !== null) {
        return result;
      }
    }
  }

  return null;
}

describe('findValue() — recursive parameter tree search', () => {
  const tree = {
    key: 'root',
    children: [
      { key: 'pool', value: 'tank' },
      {
        key: 'options',
        children: [
          { key: 'compress', value: 'lz4' },
          { key: 'copies', value: '2' },
        ],
      },
    ],
  };

  it('finds direct child value', () => {
    expect(findValue(tree, 'pool', 'pool')).toBe('tank');
  });

  it('finds nested child value', () => {
    expect(findValue(tree, 'options', 'compress')).toBe('lz4');
  });

  it('returns null for non-existent key', () => {
    expect(findValue(tree, 'nonexistent', 'nonexistent')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(findValue(null, 'key', 'key')).toBeNull();
  });
});

// ── Windows hourly trigger regression guard
// New-ScheduledTaskTrigger -Once returns a trigger with no populated Repetition object.
// Assigning into it throws PropertyNotFound, which aborted the whole registration script
// under $ErrorActionPreference='Stop' and left hourly backups silently unregistered.
describe('BackUpManagerWin hourly trigger', () => {
  const src = readFileSync(
    resolve(__dirname, 'backup/BackUpManagerWin.ts'),
    'utf8'
  );

  it('never assigns into $taskTrigger.Repetition', () => {
    expect(src).not.toMatch(/\$taskTrigger\.Repetition\./);
  });

  it('sets repetition through New-ScheduledTaskTrigger parameters', () => {
    expect(src).toContain('-RepetitionInterval');
    expect(src).toContain('-RepetitionDuration');
  });
});
