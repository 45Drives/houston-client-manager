import { describe, it, expect } from 'vitest';

// ── Replicate scrub logic from main.ts so we can test it in isolation
// These are the exact functions from main.ts.
const SENSITIVE_KEYS = [
  'password', 'passwd', 'pass', 'pwd',
  'secret', 'token', 'authorization', 'auth',
];

function scrubString(str: string): string {
  if (!str) return str;
  let out = str;
  out = out.replace(/(password\s*[:=]\s*)([^,\s"'}]+)/gi, '$1***REDACTED***');
  out = out.replace(/("password"\s*:\s*)"([^"]*)"/gi, '$1"***REDACTED***"');
  out = out.replace(/('password'\s*:\s*)'([^']*)'/gi, "$1'***REDACTED***'");
  out = out.replace(/(token|secret)\s*[:=]\s*([^,\s"'}]+)/gi, '$1=***REDACTED***');
  return out;
}

function scrubValue(value: any): any {
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v));
  if (value && typeof value === 'object') {
    const clone: any = { ...value };
    for (const key of Object.keys(clone)) {
      if (SENSITIVE_KEYS.includes(key.toLowerCase())) {
        clone[key] = '***REDACTED***';
      } else {
        clone[key] = scrubValue(clone[key]);
      }
    }
    return clone;
  }
  return value;
}

// ─────────────────────────────────────────────────
// scrubString tests
// ─────────────────────────────────────────────────
describe('scrubString()', () => {
  it('redacts "password=..." in plain text', () => {
    expect(scrubString('password=hunter2')).toBe('password=***REDACTED***');
  });

  it('redacts "password: ..." in plain text', () => {
    expect(scrubString('password: hunter2')).toBe('password: ***REDACTED***');
  });

  it('redacts JSON-style "password": "..."', () => {
    expect(scrubString('"password": "mySecret"')).toBe('"password": "***REDACTED***"');
  });

  it('redacts single-quoted password', () => {
    expect(scrubString("'password': 'mySecret'")).toBe("'password': '***REDACTED***'");
  });

  it('redacts token=...', () => {
    expect(scrubString('token=abc123xyz')).toBe('token=***REDACTED***');
  });

  it('redacts secret=...', () => {
    expect(scrubString('secret=s3cr3t')).toBe('secret=***REDACTED***');
  });

  it('leaves non-sensitive strings alone', () => {
    expect(scrubString('user=jordan host=192.168.1.1')).toBe('user=jordan host=192.168.1.1');
  });

  it('returns empty string as-is', () => {
    expect(scrubString('')).toBe('');
  });
});

// ─────────────────────────────────────────────────
// scrubValue tests
// ─────────────────────────────────────────────────
describe('scrubValue()', () => {
  it('scrubs password key in objects', () => {
    const input = { user: 'jordan', password: 'hunter2' };
    const result = scrubValue(input);
    expect(result.user).toBe('jordan');
    expect(result.password).toBe('***REDACTED***');
  });

  it('scrubs nested sensitive keys', () => {
    const input = { credentials: { token: 'abc123' } };
    const result = scrubValue(input);
    expect(result.credentials.token).toBe('***REDACTED***');
  });

  it('scrubs auth key (case-insensitive)', () => {
    const input = { Auth: 'bearer xyz' };
    const result = scrubValue(input);
    expect(result.Auth).toBe('***REDACTED***');
  });

  it('scrubs strings containing password=', () => {
    const result = scrubValue('password=s3cr3t');
    expect(result).toBe('password=***REDACTED***');
  });

  it('scrubs arrays recursively', () => {
    const input = [{ password: 'a' }, { password: 'b' }];
    const result = scrubValue(input);
    expect(result[0].password).toBe('***REDACTED***');
    expect(result[1].password).toBe('***REDACTED***');
  });

  it('returns primitives (number) unchanged', () => {
    expect(scrubValue(42)).toBe(42);
  });

  it('returns null unchanged', () => {
    expect(scrubValue(null)).toBe(null);
  });

  it('does not mutate the original object', () => {
    const input = { password: 'secret123' };
    scrubValue(input);
    expect(input.password).toBe('secret123');
  });
});
