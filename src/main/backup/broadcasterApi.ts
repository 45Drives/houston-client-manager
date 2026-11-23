// src/main/backup/broadcasterApi.ts
// Utility for calling the houston-broadcaster storage-wizard API
// from the Electron main process.

import { BackUpTask } from '@45drives/houston-common-lib';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const BROADCASTER_PORT = 9095;
const LOGIN_TIMEOUT_MS = 8000;
const API_TIMEOUT_MS = 10000;

/** Read the persistent client install ID */
export function getClientId(): string {
  try {
    return fs.readFileSync(path.join(app.getPath('userData'), 'client-id.txt'), 'utf-8').trim();
  } catch {
    return '';
  }
}

/** Get the broadcaster base URL from a host IP/name */
function baseUrl(host: string): string {
  return `http://${host}:${BROADCASTER_PORT}`;
}

/** Authenticate with the broadcaster and return a JWT */
export async function getToken(host: string, username: string, password: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl(host)}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Binds this install's ID into the token so the server can scope our
      // backup configs to us rather than trusting the request body.
      body: JSON.stringify({ username, password, clientId: getClientId() }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[broadcasterApi] Authentication rejected (HTTP ${res.status})`);
      return null;
    }
    const data = await res.json();
    if (typeof data?.token !== 'string' || !data.token) {
      console.warn('[broadcasterApi] Authentication response contained no token');
      return null;
    }
    return data.token;
  } catch {
    console.warn('[broadcasterApi] Authentication request failed');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** POST or update a backup config on the server (best-effort, never throws) */
export async function syncBackupConfig(
  host: string,
  username: string,
  password: string,
  task: BackUpTask,
  clientId: string
): Promise<boolean> {
  try {
    const token = await getToken(host, username, password);
    if (!token) {
      console.warn('[broadcasterApi] Could not authenticate — backup config not synced');
      return false;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    const res = await fetch(`${baseUrl(host)}/api/storage-wizard/backup-configs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        uuid: task.uuid,
        client_id: clientId,
        name: task.name || null,
        description: task.description || null,
        source: task.source,
        target: task.target,
        host: task.host || host,
        share: task.share || null,
        smb_user: username,
        mirror: task.mirror || false,
        repeat_frequency: task.schedule?.repeatFrequency || null,
        start_date: task.schedule?.startDate?.toISOString?.() || null,
        status: task.status || 'online',
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) console.warn(`[broadcasterApi] Backup config sync rejected (HTTP ${res.status}); existing records may require staff ownership assignment`);
    return res.ok;
  } catch (err: any) {
    console.warn('[broadcasterApi] syncBackupConfig failed:', err?.message || err);
    return false;
  }
}

/** Remove a backup config from the server (best-effort) */
export async function removeBackupConfig(
  host: string,
  username: string,
  password: string,
  uuid: string
): Promise<boolean> {
  try {
    const token = await getToken(host, username, password);
    if (!token) return false;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    const res = await fetch(`${baseUrl(host)}/api/storage-wizard/backup-configs/${encodeURIComponent(uuid)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) console.warn(`[broadcasterApi] Backup config removal rejected (HTTP ${res.status})`);
    return res.ok;
  } catch {
    console.warn('[broadcasterApi] Backup config removal failed');
    return false;
  }
}

export interface AuditEntry {
  action: string;
  target?: string;
  outcome: 'success' | 'failure';
  detail?: string;
  /** 'ssh' for actions the client performed directly, 'api' for server-executed */
  source?: 'ssh' | 'api';
}

/**
 * Record a privileged management action on the server (best-effort).
 *
 * Self-reported, so it is a forensic trail rather than an enforcement point —
 * a modified client could omit it. It becomes authoritative once management
 * operations run through the broadcaster API instead of SSH.
 */
export async function reportAuditEvent(
  host: string,
  username: string,
  password: string,
  entry: AuditEntry
): Promise<boolean> {
  try {
    const token = await getToken(host, username, password);
    if (!token) return false;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    const res = await fetch(`${baseUrl(host)}/api/storage-wizard/audit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ source: 'ssh', ...entry }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) console.warn(`[broadcasterApi] Privileged audit report rejected (HTTP ${res.status})`);
    return res.ok;
  } catch {
    console.warn('[broadcasterApi] Privileged audit reporting failed');
    return false;
  }
}

function bashJsonBody(fields: Record<string, string>): string[] {
  return [
    `{`,
    ...Object.entries(fields).map(([key, value], index) =>
      `  printf '${index ? ',' : '{'}"${key}":'; _EVT_JSON_STRING "${value}"`),
    `  printf '}'`,
    `} |`,
  ];
}

function bashEventRequests(port: number): string[] {
  return [
    `  _EVT_JSON_STRING() {`,
    `    local _JSON_VALUE="$1" _JSON_CHAR _JSON_CODE`,
    `    printf '"'`,
    `    while [[ -n "$_JSON_VALUE" ]]; do`,
    `      _JSON_CHAR="\${_JSON_VALUE:0:1}"; _JSON_VALUE="\${_JSON_VALUE:1}"`,
    `      case "$_JSON_CHAR" in`,
    `        '"') printf '\\\\"' ;;`,
    `        '\\') printf '\\\\\\\\' ;;`,
    `        *) printf -v _JSON_CODE '%d' "'$_JSON_CHAR"`,
    `           if (( _JSON_CODE < 32 )); then printf '\\\\u%04x' "$_JSON_CODE"; else printf '%s' "$_JSON_CHAR"; fi ;;`,
    `      esac`,
    `    done`,
    `    printf '"'`,
    `  }`,
    `  if command -v curl >/dev/null 2>&1 && [[ -n "$_EVT_PASS" ]] && [[ -n "\${INSTALL_ID:-}" ]]; then`,
    `    _TOKEN="$(`,
    ...bashJsonBody({ username: '$_EVT_USER', password: '$_EVT_PASS', clientId: '$INSTALL_ID' }),
    `      curl -sf --connect-timeout 5 --max-time 10 -X POST "http://$_EVT_HOST:${port}/api/login" \\`,
    `        -H 'Content-Type: application/json' --data-binary @- 2>/dev/null \\`,
    `      | sed -n 's/.*"token":"\\([^"]*\\)".*/\\1/p' || true)"`,
    `    if [[ -n "$_TOKEN" ]]; then`,
    ...bashJsonBody({
      backup_uuid: '$_EVT_UUID', client_id: '$INSTALL_ID', event_type: '$_EVT_TYPE',
      status: '${_BCAST_STATUS:-}', error: '${_BCAST_ERROR:-}',
    }),
    `      curl -sf --connect-timeout 5 --max-time 10 -X POST "http://$_EVT_HOST:${port}/api/storage-wizard/backup-events" \\`,
    `        -H 'Content-Type: application/json' --header @/dev/fd/3 \\`,
    `        --data-binary @- 3< <(printf 'Authorization: Bearer %s\\n' "$_TOKEN") \\`,
    `        >/dev/null 2>&1 || echo '[broadcasterApi] Backup event reporting failed' >&2`,
    `    else`,
    `      echo '[broadcasterApi] Backup event authentication failed' >&2`,
    `    fi`,
    `  else`,
    `    echo '[broadcasterApi] Backup reporting requires curl, credentials and a client installation ID' >&2`,
    `  fi`,
  ];
}

/**
 * Best-effort Linux/macOS event reporting using the parent's SMB_USER, CRED_FILE,
 * INSTALL_ID, _BCAST_STATUS and _BCAST_ERROR. Secrets travel through descriptors,
 * not curl arguments.
 */
export function bashEventSnippet(host: string, eventType: 'start' | 'end' | 'error', uuid: string): string {
  const port = BROADCASTER_PORT;
  // Build the lines as a plain array, then join — avoids nested template escaping issues
  const lines: string[] = [
    `# --- Report ${eventType} event to broadcaster API (best-effort) ---`,
    `(`,
    `  _EVT_HOST=${JSON.stringify(host)}`,
    `  _EVT_UUID=${JSON.stringify(uuid)}`,
    `  _EVT_TYPE=${JSON.stringify(eventType)}`,
    `  _EVT_USER="$SMB_USER"`,
    `  _EVT_PASS=""`,
    `  if [[ -n "\${CRED_FILE:-}" ]] && [[ -f "$CRED_FILE" ]]; then`,
    `    _EVT_PASS="$(grep '^password=' "$CRED_FILE" 2>/dev/null | head -1 | cut -d= -f2-)"`,
    `  fi`,
    ...bashEventRequests(port),
    `) || true`,
  ];
  return lines.join('\n');
}

/**
 * Generate a PowerShell snippet that POSTs a backup event to the broadcaster API.
 * Used inside generated .bat scripts (Windows).
 * Expects: CRED_FILE, INSTALL_ID, BACKUP_STATUS, BACKUP_ERROR as batch variables.
 */
export function batchEventSnippet(host: string, eventType: 'start' | 'end' | 'error', uuid: string): string {
  const port = BROADCASTER_PORT;

  /* Batch runs one command per line, so this must stay a single line. Batch variables
   * are expanded by cmd before PowerShell starts, which rules out -EncodedCommand. */
  const ps = [
    `try {`,
    `$cred = @{};`,
    `Get-Content '%CRED_FILE%' -ErrorAction SilentlyContinue | ForEach-Object { $k,$v = $_ -split '=',2; $cred[$k]=$v };`,
    `$body = @{username=$cred['username']; password=$cred['password']; clientId='!INSTALL_ID!'} | ConvertTo-Json;`,
    `$login = Invoke-RestMethod -Uri 'http://${host}:${port}/api/login' -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 5;`,
    `if ($login.token) {`,
    `$evt = @{backup_uuid='${uuid}'; client_id='!INSTALL_ID!'; event_type='${eventType}'; status='!BACKUP_STATUS!'; error='!BACKUP_ERROR!'} | ConvertTo-Json;`,
    `$headers = @{Authorization='Bearer '+$login.token};`,
    `Invoke-RestMethod -Uri 'http://${host}:${port}/api/storage-wizard/backup-events' -Method POST -ContentType 'application/json' -Body $evt -Headers $headers -TimeoutSec 5 | Out-Null`,
    `}`,
    `} catch {}`,
  ].join(' ');

  return [
    `:: --- Report ${eventType} event to broadcaster API (best-effort) ---`,
    `powershell -NoProfile -NonInteractive -Command "& { ${ps} }" >nul 2>&1`,
  ].join('\n');
}

/**
 * Generate a bash snippet for macOS that POSTs a backup event to the broadcaster API.
 * macOS uses Keychain instead of credential files, so we read the password from there.
 * Expects: SMB_USER, INSTALL_ID, _BCAST_STATUS, _BCAST_ERROR
 */
export function bashEventSnippetMac(host: string, eventType: 'start' | 'end' | 'error', uuid: string, keychainService: string, keychainUser: string): string {
  const port = BROADCASTER_PORT;
  const lines: string[] = [
    `# --- Report ${eventType} event to broadcaster API (best-effort) ---`,
    `(`,
    `  _EVT_HOST=${JSON.stringify(host)}`,
    `  _EVT_UUID=${JSON.stringify(uuid)}`,
    `  _EVT_TYPE=${JSON.stringify(eventType)}`,
    `  _EVT_USER="$SMB_USER"`,
    `  _EVT_PASS="$(security find-generic-password -s ${JSON.stringify(keychainService)} -a ${JSON.stringify(keychainUser)} -w 2>/dev/null || true)"`,
    ...bashEventRequests(port),
    `) || true`,
  ];
  return lines.join('\n');
}
