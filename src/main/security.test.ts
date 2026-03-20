import { describe, it, expect } from 'vitest';
import {
  assertSafeHost,
  assertSafeShare,
  assertSafeUsername,
  shellQuote,
  toBase64,
  sanitizeCronComment,
  escapeCmdValue,
} from './security';

// ─────────────────────────────────────────────────────────────────────────────
// assertSafeHost
// ─────────────────────────────────────────────────────────────────────────────
describe('assertSafeHost()', () => {
  it('accepts valid hostnames', () => {
    expect(assertSafeHost('myserver')).toBe('myserver');
    expect(assertSafeHost('my-server.local')).toBe('my-server.local');
    expect(assertSafeHost('192.168.1.100')).toBe('192.168.1.100');
  });

  it('trims whitespace', () => {
    expect(assertSafeHost('  myhost  ')).toBe('myhost');
  });

  it('rejects empty string', () => {
    expect(() => assertSafeHost('')).toThrow('Host is required');
    expect(() => assertSafeHost('   ')).toThrow('Host is required');
  });

  it('rejects path traversal characters', () => {
    expect(() => assertSafeHost('host/evil')).toThrow('invalid path characters');
    expect(() => assertSafeHost('host\\evil')).toThrow('invalid path characters');
    expect(() => assertSafeHost('..')).toThrow('invalid path characters');
    expect(() => assertSafeHost('host/../etc')).toThrow('invalid path characters');
  });

  it('rejects command injection characters', () => {
    expect(() => assertSafeHost('host;evil')).toThrow('unsupported characters');
    expect(() => assertSafeHost('host$(whoami)')).toThrow('unsupported characters');
    expect(() => assertSafeHost('host`id`')).toThrow('unsupported characters');
    expect(() => assertSafeHost('host | cat')).toThrow('unsupported characters');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// assertSafeShare
// ─────────────────────────────────────────────────────────────────────────────
describe('assertSafeShare()', () => {
  it('accepts valid share names', () => {
    expect(assertSafeShare('MyBackups')).toBe('MyBackups');
    expect(assertSafeShare('backup_2024')).toBe('backup_2024');
    expect(assertSafeShare('Share with spaces')).toBe('Share with spaces');
    expect(assertSafeShare('my.share')).toBe('my.share');
  });

  it('rejects empty string', () => {
    expect(() => assertSafeShare('')).toThrow('Share is required');
  });

  it('rejects path traversal', () => {
    expect(() => assertSafeShare('..')).toThrow('invalid path characters');
    expect(() => assertSafeShare('share/../../etc')).toThrow('invalid path characters');
    expect(() => assertSafeShare('share\\evil')).toThrow('invalid path characters');
  });

  it('rejects special characters', () => {
    expect(() => assertSafeShare('share;evil')).toThrow('unsupported characters');
    expect(() => assertSafeShare('share$(cmd)')).toThrow('unsupported characters');
    expect(() => assertSafeShare('share`cmd`')).toThrow('unsupported characters');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// assertSafeUsername
// ─────────────────────────────────────────────────────────────────────────────
describe('assertSafeUsername()', () => {
  it('accepts valid usernames', () => {
    expect(assertSafeUsername('root')).toBe('root');
    expect(assertSafeUsername('user_name')).toBe('user_name');
    expect(assertSafeUsername('user.name')).toBe('user.name');
    expect(assertSafeUsername('user@domain')).toBe('user@domain');
    expect(assertSafeUsername('user-name')).toBe('user-name');
  });

  it('rejects empty string', () => {
    expect(() => assertSafeUsername('')).toThrow('Username is required');
  });

  it('rejects path traversal', () => {
    expect(() => assertSafeUsername('..')).toThrow('invalid path characters');
    expect(() => assertSafeUsername('user/../root')).toThrow('invalid path characters');
  });

  it('rejects injection characters', () => {
    expect(() => assertSafeUsername('user;evil')).toThrow('unsupported characters');
    expect(() => assertSafeUsername('user$(whoami)')).toThrow('unsupported characters');
    expect(() => assertSafeUsername('user`id`')).toThrow('unsupported characters');
    expect(() => assertSafeUsername('user|cat')).toThrow('unsupported characters');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// shellQuote
// ─────────────────────────────────────────────────────────────────────────────
describe('shellQuote()', () => {
  it('wraps simple values in single quotes', () => {
    expect(shellQuote('hello')).toBe("'hello'");
  });

  it('escapes embedded single quotes', () => {
    expect(shellQuote("it's")).toBe("'it'\"'\"'s'");
  });

  it('handles empty string', () => {
    expect(shellQuote('')).toBe("''");
  });

  it('handles space-containing values', () => {
    expect(shellQuote('hello world')).toBe("'hello world'");
  });

  it('handles special shell characters safely', () => {
    const dangerous = 'rm -rf /; echo pwned';
    const quoted = shellQuote(dangerous);
    expect(quoted).toBe("'rm -rf /; echo pwned'");
    // The value is safely inside single quotes, so shell won't interpret ; as a separator
  });

  it('handles $() subshell attempts', () => {
    expect(shellQuote('$(whoami)')).toBe("'$(whoami)'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// toBase64
// ─────────────────────────────────────────────────────────────────────────────
describe('toBase64()', () => {
  it('encodes strings to base64', () => {
    expect(toBase64('hello')).toBe('aGVsbG8=');
    expect(toBase64('')).toBe('');
  });

  it('handles unicode', () => {
    const encoded = toBase64('café');
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe('café');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sanitizeCronComment
// ─────────────────────────────────────────────────────────────────────────────
describe('sanitizeCronComment()', () => {
  it('strips newlines', () => {
    expect(sanitizeCronComment('line1\nline2')).toBe('line1 line2');
    expect(sanitizeCronComment('line1\r\nline2')).toBe('line1  line2');
  });

  it('strips hash characters', () => {
    expect(sanitizeCronComment('this # is a comment')).toBe('this  is a comment');
  });

  it('trims whitespace', () => {
    expect(sanitizeCronComment('  spaced  ')).toBe('spaced');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// escapeCmdValue
// ─────────────────────────────────────────────────────────────────────────────
describe('escapeCmdValue()', () => {
  it('escapes percent signs', () => {
    expect(escapeCmdValue('100%')).toBe('100%%');
  });

  it('escapes caret', () => {
    expect(escapeCmdValue('a^b')).toBe('a^^b');
  });

  it('escapes ampersand', () => {
    expect(escapeCmdValue('a&b')).toBe('a^&b');
  });

  it('escapes pipe', () => {
    expect(escapeCmdValue('a|b')).toBe('a^|b');
  });

  it('escapes angle brackets', () => {
    expect(escapeCmdValue('a<b>c')).toBe('a^<b^>c');
  });

  it('escapes double quotes', () => {
    expect(escapeCmdValue('say "hello"')).toBe('say ^"hello^"');
  });

  it('leaves safe strings alone', () => {
    expect(escapeCmdValue('hello_world')).toBe('hello_world');
  });
});
