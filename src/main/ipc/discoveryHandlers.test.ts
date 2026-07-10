import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DiscoveryContext } from './discoveryHandlers';
import { handleDiscoveryMessage } from './discoveryHandlers';

// ── Mock the settingsStore ──────────────────────────────────────────────────

let mockFallbackEnabled = true;

vi.mock('../settingsStore', () => ({
  loadSettings: () => ({
    discoveryFallbackEnabled: mockFallbackEnabled,
  }),
}));

// ── Mock checkSSH ───────────────────────────────────────────────────────────

vi.mock('../setupSsh', () => ({
  checkSSH: vi.fn().mockResolvedValue(true),
}));

// ── Mock global fetch (addManualIP makes HTTPS probe) ────────────────────────

const mockFetch = vi.fn().mockResolvedValue({ ok: true });
vi.stubGlobal('fetch', mockFetch);

// ── Helper to build a fresh context ─────────────────────────────────────────

function makeCtx(overrides: Partial<DiscoveryContext> = {}): DiscoveryContext {
  return {
    discoveredServers: [],
    mainWindow: {
      webContents: { send: vi.fn() },
    } as any,
    notify: vi.fn(),
    mDNSClient: { query: vi.fn() },
    serviceType: '_houstonserver._tcp.local',
    TIMEOUT_DURATION: 500, // short for testing
    doFallbackScan: vi.fn().mockResolvedValue([]),
    setDiscoveredServers: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  mockFallbackEnabled = true;
  mockFetch.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// rescanServers
// ─────────────────────────────────────────────────────────────────────────────
describe('handleDiscoveryMessage — rescanServers', () => {
  it('clears servers and re-triggers mDNS query', async () => {
    const ctx = makeCtx();
    const result = await handleDiscoveryMessage({ type: 'rescanServers' }, ctx);

    expect(result).toBe(true);
    expect(ctx.setDiscoveredServers).toHaveBeenCalledWith([]);
    expect(ctx.mDNSClient.query).toHaveBeenCalledWith({
      questions: [{ name: ctx.serviceType, type: 'PTR' }],
    });
  });

  it('runs fallback scan when no servers found and fallback enabled', async () => {
    const fallbackServers = [{ ip: '192.168.1.50', name: 'fallback' }];
    const ctx = makeCtx({
      doFallbackScan: vi.fn().mockResolvedValue(fallbackServers),
    });

    mockFallbackEnabled = true;
    await handleDiscoveryMessage({ type: 'rescanServers' }, ctx);

    // advance past TIMEOUT_DURATION
    await vi.advanceTimersByTimeAsync(600);

    expect(ctx.doFallbackScan).toHaveBeenCalled();
    expect((ctx.mainWindow.webContents.send as any).mock.calls).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['discovered-servers', fallbackServers]),
      ])
    );
  });

  it('skips fallback scan when discoveryFallbackEnabled is false', async () => {
    const ctx = makeCtx({
      doFallbackScan: vi.fn().mockResolvedValue([{ ip: '10.0.0.1' }]),
    });

    mockFallbackEnabled = false;
    await handleDiscoveryMessage({ type: 'rescanServers' }, ctx);

    await vi.advanceTimersByTimeAsync(600);

    expect(ctx.doFallbackScan).not.toHaveBeenCalled();
  });

  it('does not run fallback if servers were discovered via mDNS', async () => {
    const ctx = makeCtx({
      doFallbackScan: vi.fn().mockResolvedValue([]),
    });

    // Simulate mDNS discovering a server after the query
    await handleDiscoveryMessage({ type: 'rescanServers' }, ctx);
    ctx.discoveredServers.push({ ip: '192.168.1.10' } as any);

    await vi.advanceTimersByTimeAsync(600);

    expect(ctx.doFallbackScan).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// addManualIP
// ─────────────────────────────────────────────────────────────────────────────
describe('handleDiscoveryMessage — addManualIP', () => {
  it('adds a reachable server to discoveredServers', async () => {
    const ctx = makeCtx();
    const result = await handleDiscoveryMessage(
      { type: 'addManualIP', ip: '10.0.0.5', manuallyAdded: true },
      ctx,
    );
    expect(result).toBe(true);
    expect(ctx.discoveredServers.length).toBe(1);
    expect(ctx.discoveredServers[0].ip).toBe('10.0.0.5');
    expect(ctx.discoveredServers[0].manuallyAdded).toBe(true);
  });

  it('updates lastSeen for an existing server', async () => {
    const ctx = makeCtx({
      discoveredServers: [{
        ip: '10.0.0.5',
        name: '10.0.0.5',
        lastSeen: 1000,
        manuallyAdded: true,
        status: 'unknown',
        setupComplete: false,
        serverName: '',
        shareName: '',
        setupTime: '',
        serverInfo: { moboMake: '', moboModel: '', serverModel: '', aliasStyle: '', chassisSize: '' },
        fallbackAdded: false,
      }] as any,
    });

    await handleDiscoveryMessage(
      { type: 'addManualIP', ip: '10.0.0.5' },
      ctx,
    );
    expect(ctx.discoveredServers.length).toBe(1);
    expect(ctx.discoveredServers[0].lastSeen).toBeGreaterThan(1000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unknown message type
// ─────────────────────────────────────────────────────────────────────────────
describe('handleDiscoveryMessage — unknown', () => {
  it('returns false for unrecognized message types', async () => {
    const ctx = makeCtx();
    const result = await handleDiscoveryMessage({ type: 'randomThing' }, ctx);
    expect(result).toBe(false);
  });
});
