/**
 * Plain-English classification of connectivity failures.
 *
 * Shared by the renderer (webview, dashboard cards, wizards) and the main
 * process (SSH, log viewer) so the same underlying problem always reads the
 * same way to the user — and so callers can tell a temporary blip (server
 * rebooting) apart from something that needs their attention (wrong password).
 */

export type ConnectivityKind =
  | 'aborted'
  | 'offline'
  | 'unreachable'
  | 'refused'
  | 'timeout'
  | 'dns'
  | 'interrupted'
  | 'certificate'
  | 'auth'
  | 'unknown';

export interface ConnectivityFailure {
  kind: ConnectivityKind;
  /** One-sentence description of what went wrong, safe to show to any user. */
  message: string;
  /** Optional follow-up sentence suggesting what to do or expect. */
  hint?: string;
  /** True when the problem usually clears on its own (reboot, network blip). */
  transient: boolean;
  /** Raw code/description kept for the log file, never shown in the UI. */
  detail?: string;
}

/** Chromium net error codes reported by `<webview>` did-fail-load. */
const CHROMIUM_KINDS: Record<number, ConnectivityKind> = {
  [-3]: 'aborted', // ABORTED — navigation superseded by a newer one
  [-7]: 'timeout', // TIMED_OUT
  [-15]: 'interrupted', // SOCKET_NOT_CONNECTED
  [-21]: 'interrupted', // NETWORK_CHANGED
  [-100]: 'interrupted', // CONNECTION_CLOSED
  [-101]: 'interrupted', // CONNECTION_RESET
  [-102]: 'refused', // CONNECTION_REFUSED
  [-104]: 'refused', // CONNECTION_FAILED
  [-105]: 'dns', // NAME_NOT_RESOLVED
  [-106]: 'offline', // INTERNET_DISCONNECTED
  [-109]: 'unreachable', // ADDRESS_UNREACHABLE
  [-118]: 'timeout', // CONNECTION_TIMED_OUT
  [-130]: 'unreachable', // PROXY_CONNECTION_FAILED
  [-138]: 'unreachable', // NETWORK_ACCESS_DENIED
  [-324]: 'interrupted', // EMPTY_RESPONSE
  [-200]: 'certificate', // CERT_COMMON_NAME_INVALID
  [-201]: 'certificate', // CERT_DATE_INVALID
  [-202]: 'certificate', // CERT_AUTHORITY_INVALID
  [-207]: 'certificate', // CERT_REVOKED
  [-501]: 'certificate', // INSECURE_RESPONSE
};

/** Node/libuv syscall codes surfaced by SSH, fetch and raw sockets. */
const SYSCALL_KINDS: Record<string, ConnectivityKind> = {
  EHOSTUNREACH: 'unreachable',
  ENETUNREACH: 'unreachable',
  EHOSTDOWN: 'unreachable',
  ENETDOWN: 'offline',
  ECONNREFUSED: 'refused',
  ETIMEDOUT: 'timeout',
  ECONNRESET: 'interrupted',
  ECONNABORTED: 'interrupted',
  ESHUTDOWN: 'interrupted',
  EPIPE: 'interrupted',
  ENOTFOUND: 'dns',
  EAI_AGAIN: 'dns',
};

const TRANSIENT_KINDS: ReadonlySet<ConnectivityKind> = new Set<ConnectivityKind>([
  'unreachable',
  'refused',
  'timeout',
  'interrupted',
  'offline',
  'dns',
]);

function phrasing(kind: ConnectivityKind, target: string): { message: string; hint?: string } {
  switch (kind) {
    case 'unreachable':
      return {
        message: `Can't reach ${target} right now.`,
        hint: 'It may be restarting, powered off, or off the network.',
      };
    case 'refused':
      return {
        message: `${target} isn't accepting connections yet.`,
        hint: "It may still be starting up, or remote access (SSH) isn't enabled on it.",
      };
    case 'timeout':
      return {
        message: `${target} took too long to respond.`,
        hint: 'It may be busy, restarting, or on a slow connection.',
      };
    case 'dns':
      return {
        message: `Couldn't look up the address for ${target}.`,
        hint: 'The server name may have changed, or it may still be restarting.',
      };
    case 'offline':
      return {
        message: 'This computer appears to be offline.',
        hint: 'Check your network or Wi-Fi connection.',
      };
    case 'interrupted':
      return {
        message: `The connection to ${target} was interrupted.`,
        hint: 'It may be restarting, or the network dropped briefly.',
      };
    case 'certificate':
      return {
        message: `The security certificate for ${target} could not be verified.`,
        hint: "If the server was recently reinstalled or renamed, you'll need to trust it again.",
      };
    case 'auth':
      return {
        message: `Sign-in to ${target} was rejected.`,
        hint: 'Double-check the username and password, then try again.',
      };
    case 'aborted':
      return { message: 'The page load was cancelled.' };
    default:
      return { message: `Something went wrong talking to ${target}.` };
  }
}

function build(kind: ConnectivityKind, target: string, detail?: string): ConnectivityFailure {
  const { message, hint } = phrasing(kind, target);
  return { kind, message, hint, transient: TRANSIENT_KINDS.has(kind), detail };
}

function targetName(host?: string): string {
  const trimmed = (host || '').trim();
  return trimmed || 'the server';
}

/** Classify a Chromium `did-fail-load` error code from a `<webview>`. */
export function describeLoadError(
  errorCode: number,
  host?: string,
  errorDescription?: string,
): ConnectivityFailure {
  const kind = CHROMIUM_KINDS[errorCode] ?? 'unknown';
  const detail = `${errorDescription || 'load failed'} (${errorCode})`;
  return build(kind, targetName(host), detail);
}

/** Classify any thrown error / rejected promise from a network operation. */
export function describeConnectionError(err: unknown, host?: string): ConnectivityFailure {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  const target = targetName(host);

  if (code && SYSCALL_KINDS[code]) return build(SYSCALL_KINDS[code], target, raw);

  const upper = raw.toUpperCase();
  for (const [syscall, kind] of Object.entries(SYSCALL_KINDS)) {
    if (upper.includes(syscall)) return build(kind, target, raw);
  }

  const lower = raw.toLowerCase();
  if (
    lower.includes('authentic') ||
    lower.includes('permission denied') ||
    lower.includes('invalid credentials') ||
    lower.includes('bad password')
  ) {
    return build('auth', target, raw);
  }
  // ssh2 phrasing for a socket that died before/during key exchange — a
  // restarting sshd looks exactly like this.
  if (
    lower.includes('before handshake') ||
    lower.includes('handshake failed') ||
    lower.includes('connection lost') ||
    lower.includes('socket closed') ||
    lower.includes('client-socket')
  ) {
    return build('interrupted', target, raw);
  }
  if (lower.includes('timed out') || lower.includes('timeout') || lower.includes('aborted')) {
    return build('timeout', target, raw);
  }
  if (lower.includes('getaddrinfo')) return build('dns', target, raw);
  if (lower.includes('connection refused')) return build('refused', target, raw);
  if (lower.includes('certificate') || lower.includes('self-signed') || lower.includes('cert_')) {
    return build('certificate', target, raw);
  }

  return { ...build('unknown', target, raw), message: raw || `Something went wrong talking to ${target}.` };
}

/** Convenience: does this error look like it will fix itself if we retry? */
export function isTransientConnectionError(err: unknown, host?: string): boolean {
  return describeConnectionError(err, host).transient;
}

/** Single-line form suitable for a log file or a toast. */
export function failureLine(failure: ConnectivityFailure): string {
  return failure.hint ? `${failure.message} ${failure.hint}` : failure.message;
}
