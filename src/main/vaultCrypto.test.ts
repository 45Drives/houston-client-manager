import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const tmpDir = '/tmp/vaultCrypto-test-' + Date.now();

const safeStorageMock = {
  available: true,
  isEncryptionAvailable: () => safeStorageMock.available,
  getSelectedStorageBackend: () => (safeStorageMock.available ? 'gnome-libsecret' : 'basic_text'),
  encryptString: (s: string) => Buffer.from('OS:' + s, 'utf-8'),
  decryptString: (b: Buffer) => {
    const s = b.toString('utf-8');
    if (!s.startsWith('OS:')) throw new Error('bad blob');
    return s.slice(3);
  },
};

vi.mock('electron', () => ({
  app: { getPath: (_name: string) => tmpDir },
  safeStorage: safeStorageMock,
}));

async function freshImport() {
  vi.resetModules();
  return await import('./vaultCrypto');
}

beforeEach(() => {
  safeStorageMock.available = true;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('vaultCrypto', () => {
  it('uses the OS keychain when it is available', async () => {
    const vc = await freshImport();
    const blob = vc.encryptSecret('hunter2');

    expect(vc.getVaultBackend()).toBe('os');
    expect(vc.isFileBackedBlob(blob)).toBe(false);
    expect(vc.decryptSecret(blob)).toBe('hunter2');
    expect(fs.existsSync(path.join(tmpDir, 'vault.key'))).toBe(false);
  });

  it('falls back to a local key file when no OS keychain exists', async () => {
    safeStorageMock.available = false;
    const vc = await freshImport();
    const blob = vc.encryptSecret('hunter2');

    expect(vc.getVaultBackend()).toBe('file');
    expect(vc.isVaultEncryptionAvailable()).toBe(true);
    expect(vc.isFileBackedBlob(blob)).toBe(true);
    expect(blob).not.toContain('hunter2');
    expect(vc.decryptSecret(blob)).toBe('hunter2');
  });

  it('writes the fallback key file with owner-only permissions', async () => {
    safeStorageMock.available = false;
    const vc = await freshImport();
    vc.encryptSecret('hunter2');

    const keyPath = path.join(tmpDir, 'vault.key');
    expect(fs.existsSync(keyPath)).toBe(true);
    // Windows NTFS does not honor POSIX 0600 via fs.chmod/writeFile mode.
    if (process.platform === 'win32') return;
    const mode = fs.statSync(keyPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('rejects a tampered fallback blob instead of returning garbage', async () => {
    safeStorageMock.available = false;
    const vc = await freshImport();
    const blob = vc.encryptSecret('hunter2');

    const raw = Buffer.from(blob.split(':')[1], 'base64');
    raw[raw.length - 1] ^= 0xff;
    expect(vc.decryptSecret('aesgcm1:' + raw.toString('base64'))).toBe('');
  });

  it('still reads fallback blobs after the keychain comes back', async () => {
    safeStorageMock.available = false;
    const vc = await freshImport();
    const blob = vc.encryptSecret('hunter2');

    safeStorageMock.available = true;
    expect(vc.getVaultBackend()).toBe('os');
    expect(vc.decryptSecret(blob)).toBe('hunter2');
  });

  it('returns empty rather than throwing when an OS blob is unreadable', async () => {
    const vc = await freshImport();
    const blob = vc.encryptSecret('hunter2');

    safeStorageMock.available = false;
    expect(vc.decryptSecret(blob)).toBe('');
  });

  it('reports the degraded backend with a reason', async () => {
    safeStorageMock.available = false;
    const vc = await freshImport();
    const status = vc.getVaultCryptoStatus();

    expect(status.backend).toBe('file');
    expect(status.osEncryptionAvailable).toBe(false);
    expect(status.keyFilePath).toBe(path.join(tmpDir, 'vault.key'));
    expect(status.reason).toBeTruthy();
  });

  it('replaces a malformed key file instead of getting stuck', async () => {
    safeStorageMock.available = false;
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'vault.key'), 'not-a-key');

    const vc = await freshImport();
    expect(vc.decryptSecret(vc.encryptSecret('hunter2'))).toBe('hunter2');
    expect(fs.readdirSync(tmpDir).some(f => f.startsWith('vault.key.bad-'))).toBe(true);
  });
});
