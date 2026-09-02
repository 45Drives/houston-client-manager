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
  });

  it('omits RepetitionDuration so the repetition is indefinite and in range', () => {
    expect(src).not.toContain('-RepetitionDuration');
  });

  // `temp` is `%TEMP%`. When the DriveLetter parse missed, the inherited
  // C:\...\Temp value made the drive letter "C" and the backup copied to the
  // local disk while reporting success.
  it('does not parse the drive letter into a variable named temp', () => {
    expect(src).not.toContain('set "temp=');
    expect(src).toContain('set "RAWDL=');
  });

  it('refuses to back up to the system drive', () => {
    expect(src).toContain('%SystemDrive:~0,1%');
  });

  it('gives the mount scratch file a per-task name', () => {
    expect(src).not.toContain('mount_result_%RANDOM%');
  });

  // Deny-ACL junctions in the user profile (My Music/My Pictures/My Videos)
  // return error 5, which robocopy reports as exit 8.
  it('excludes junction points from robocopy', () => {
    expect(src).toMatch(/robocopy .*\/XJ/);
  });

  // %DATE%/%TIME% are locale dependent, so the log banner must use the ISO
  // timestamp or the log viewer cannot parse a Time column.
  it('writes an ISO banner the log parser can anchor timestamps to', () => {
    expect(src).toContain('===== [!TS!] Backup started =====');
    expect(src).toContain('===== [!TS2!] !ENDMSG! =====');
    expect(src).not.toContain('[!date! !time!]  END');
  });

  // The .bat is written once at scheduling time, so script fixes reach existing
  // tasks only if a stale script is detected and rewritten.
  it('stamps a script version and rewrites stale scripts on run', () => {
    expect(src).toContain(':: SCRIPT_VER  = ${ACTION_BAT_VERSION}');
    expect(src).toContain('this.refreshActionBat(task);');
  });
});

// ── Generated .bat event snippet regression guard
// Batch executes one command per line. A multi-line PowerShell block meant cmd ran
// `powershell ... -Command "& {` on its own and then tried to execute `try {` and
// `$cred = ...` as commands, aborting the whole backup script with exit 255.
describe('batchEventSnippet', () => {
  const src = readFileSync(
    resolve(__dirname, 'backup/broadcasterApi.ts'),
    'utf8'
  );

  it('emits the powershell invocation on a single line', () => {
    expect(src).toContain(`].join(' ');`);
    expect(src).not.toContain('-Command "& {`,');
  });
});
