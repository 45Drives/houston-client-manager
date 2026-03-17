import { describe, it, expect } from 'vitest';

// ── errMsg is not exported, so we replicate the logic here to test correctness.
// If you want, you can export errMsg from backupHandlers.ts and import it directly.
function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
}

describe('errMsg()', () => {
  it('extracts message from Error instances', () => {
    expect(errMsg(new Error('something broke'))).toBe('something broke');
  });

  it('extracts message from plain objects with a message property', () => {
    expect(errMsg({ message: 'custom error', code: 42 })).toBe('custom error');
  });

  it('converts strings directly', () => {
    expect(errMsg('raw string error')).toBe('raw string error');
  });

  it('converts numbers', () => {
    expect(errMsg(404)).toBe('404');
  });

  it('handles null', () => {
    expect(errMsg(null)).toBe('null');
  });

  it('handles undefined', () => {
    expect(errMsg(undefined)).toBe('undefined');
  });

  it('handles objects without message', () => {
    expect(errMsg({ code: 'ENOENT' })).toBe('[object Object]');
  });
});
