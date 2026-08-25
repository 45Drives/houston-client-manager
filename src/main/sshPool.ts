/**
 * sshPool — per-host SSH connection reuse for server operations.
 *
 * Every restore/snapshot/topology call used to open its own connection and tear
 * it down again, and `connectWithFallback` walks up to four auth tiers, each a
 * separate TCP connection and handshake. On a host with sshd's default
 * `MaxStartups` (10:30:100) or OpenSSH 9.8+ `PerSourcePenalties`, that burst of
 * short-lived and deliberately-failing handshakes is enough to get connections
 * dropped pre-auth — which surfaces as "Connection lost before handshake".
 *
 * This pool keeps one authenticated connection per host+user alive between
 * operations and multiplexes work over its channels instead.
 */
import { NodeSSH } from 'node-ssh';
import { connectWithFallback, type SshAuth } from './setupSsh';
import { logEvent, errMsg } from './logging';

/** How long a connection with no active work stays open before being closed. */
const IDLE_TIMEOUT_MS = 60_000;
/** OpenSSH defaults to MaxSessions 10; stay under it so a burst never gets a channel refused. */
const MAX_LEASES_PER_CONNECTION = 6;
/** Guard against spinning if a host accepts connections but drops them instantly. */
const MAX_CONNECT_ATTEMPTS = 3;
/** Upper bound on waiting for other callers' in-flight connects. */
const MAX_ACQUIRE_ITERATIONS = 12;

interface PooledConnection {
  key: string;
  ssh: NodeSSH;
  /** The instance's original `dispose`, replaced on the handle by `release`. */
  realDispose: () => void;
  leases: number;
  idleTimer: NodeJS.Timeout | null;
  closed: boolean;
}

const pool = new Map<string, PooledConnection[]>();
const connecting = new Map<string, Promise<PooledConnection>>();

function poolKey(host: string, username: string): string {
  return `${host}\u0000${username}`;
}

function clearIdle(entry: PooledConnection) {
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }
}

function evict(entry: PooledConnection, reason: string) {
  if (entry.closed) return;
  entry.closed = true;
  clearIdle(entry);

  const list = pool.get(entry.key);
  if (list) {
    const idx = list.indexOf(entry);
    if (idx !== -1) list.splice(idx, 1);
    if (list.length === 0) pool.delete(entry.key);
  }

  try {
    entry.realDispose();
  } catch { /* already gone */ }

  logEvent('ssh:pool.evict', { key: entry.key, reason, leases: entry.leases }, 'debug');
}

function release(entry: PooledConnection) {
  entry.leases = Math.max(0, entry.leases - 1);
  if (entry.leases > 0 || entry.closed) return;

  clearIdle(entry);
  entry.idleTimer = setTimeout(() => evict(entry, 'idle'), IDLE_TIMEOUT_MS);
  // Never hold the process open just to keep a warm socket around.
  entry.idleTimer.unref?.();
}

function pickUsable(key: string): PooledConnection | null {
  const list = pool.get(key);
  if (!list) return null;

  for (const entry of [...list]) {
    if (entry.closed) continue;
    if (!entry.ssh.isConnected()) {
      evict(entry, 'disconnected');
      continue;
    }
    if (entry.leases < MAX_LEASES_PER_CONNECTION) return entry;
  }
  return null;
}

async function createConnection(key: string, host: string, auth: SshAuth): Promise<PooledConnection> {
  const ssh = await connectWithFallback(host, auth);

  const entry: PooledConnection = {
    key,
    ssh,
    realDispose: ssh.dispose.bind(ssh),
    leases: 0,
    idleTimer: null,
    closed: false,
  };

  // Callers keep their existing `try { ... } finally { ssh.dispose() }` shape;
  // on a pooled connection that returns the lease instead of dropping the socket.
  ssh.dispose = () => release(entry);

  // An idle pooled socket that drops would otherwise emit an unhandled 'error'.
  const client = ssh.connection;
  if (client) {
    client.on('close', () => evict(entry, 'closed'));
    client.on('end', () => evict(entry, 'ended'));
    client.on('error', (err: unknown) => {
      logEvent('ssh:pool.error', { host, error: errMsg(err) }, 'debug');
      evict(entry, 'error');
    });
  }

  const list = pool.get(key) ?? [];
  list.push(entry);
  pool.set(key, list);

  logEvent('ssh:pool.open', { host, username: auth.username, connections: list.length }, 'debug');
  return entry;
}

/**
 * Borrow a connection to `host`. The returned instance is shared — call
 * `dispose()` when done to return it to the pool, exactly as before.
 */
export async function acquireSSH(host: string, auth: SshAuth): Promise<NodeSSH> {
  const key = poolKey(host, auth.username);
  let creates = 0;

  for (let iteration = 0; iteration < MAX_ACQUIRE_ITERATIONS; iteration++) {
    const usable = pickUsable(key);
    if (usable) {
      usable.leases++;
      clearIdle(usable);
      return usable.ssh;
    }

    const inflight = connecting.get(key);
    if (inflight) {
      // Someone else is already dialing this host; wait for them rather than
      // adding another handshake to a server that may be shedding them.
      await inflight.catch(() => { /* the originator reports it */ });
      continue;
    }

    if (creates >= MAX_CONNECT_ATTEMPTS) break;
    creates++;

    const pending = createConnection(key, host, auth);
    connecting.set(key, pending);
    try {
      const entry = await pending;
      entry.leases++;
      clearIdle(entry);
      return entry.ssh;
    } finally {
      connecting.delete(key);
    }
  }

  throw new Error(`Could not hold a connection to ${host} open long enough to run the request.`);
}

/** Close every pooled connection. Call on app shutdown. */
export function disposeAllSSH() {
  for (const list of [...pool.values()]) {
    for (const entry of [...list]) evict(entry, 'shutdown');
  }
  pool.clear();
  connecting.clear();
}
