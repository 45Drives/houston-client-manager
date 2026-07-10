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
async function getToken(host: string, username: string, password: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);
    const res = await fetch(`${baseUrl(host)}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    return data.token || null;
  } catch {
    return null;
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
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Generate a bash snippet that POSTs a backup event to the broadcaster API.
 * Used inside generated cron scripts (Linux/Mac).
 * Authenticates with credentials from the .cred file, then POSTs the event.
 * All calls are best-effort (|| true) so backup never fails due to API issues.
 *
 * Expects these variables to be defined in the parent script:
 *   SMB_USER, CRED_FILE, INSTALL_ID, _BCAST_STATUS (for 'end'), _BCAST_ERROR (for 'end')
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
    `  if command -v curl >/dev/null 2>&1 && [[ -n "$_EVT_PASS" ]]; then`,
    `    _TOKEN="$(curl -sf --connect-timeout 5 -X POST "http://$_EVT_HOST:${port}/api/login" \\`,
    `      -H 'Content-Type: application/json' \\`,
    `      -d "{\\"username\\":\\"$_EVT_USER\\",\\"password\\":\\"$_EVT_PASS\\"}" 2>/dev/null \\`,
    `      | sed -n 's/.*"token":"\\([^"]*\\)".*/\\1/p' || true)"`,
    `    if [[ -n "$_TOKEN" ]]; then`,
    `      curl -sf --connect-timeout 5 -X POST "http://$_EVT_HOST:${port}/api/storage-wizard/backup-events" \\`,
    `        -H 'Content-Type: application/json' \\`,
    `        -H "Authorization: Bearer $_TOKEN" \\`,
    `        -d "{\\"backup_uuid\\":\\"$_EVT_UUID\\",\\"client_id\\":\\"$INSTALL_ID\\",\\"event_type\\":\\"$_EVT_TYPE\\",\\"status\\":\\"\${_BCAST_STATUS:-}\\",\\"error\\":\\"\${_BCAST_ERROR:-}\\"}" \\`,
    `        >/dev/null 2>&1 || true`,
    `    fi`,
    `  fi`,
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
  const lines = [
    `:: --- Report ${eventType} event to broadcaster API (best-effort) ---`,
    `powershell -NoProfile -NonInteractive -Command "& {`,
    `  try {`,
    `    $cred = @{}; Get-Content '%CRED_FILE%' -ErrorAction SilentlyContinue | ForEach-Object { $k,$v = $_ -split '=',2; $cred[$k]=$v }`,
    `    $body = @{username=$cred['username']; password=$cred['password']} | ConvertTo-Json`,
    `    $login = Invoke-RestMethod -Uri 'http://${host}:${port}/api/login' -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 5`,
    `    if ($login.token) {`,
    `      $evt = @{backup_uuid='${uuid}'; client_id='!INSTALL_ID!'; event_type='${eventType}'; status='!BACKUP_STATUS!'; error='!BACKUP_ERROR!'} | ConvertTo-Json`,
    `      $headers = @{Authorization='Bearer '+$login.token}`,
    `      Invoke-RestMethod -Uri 'http://${host}:${port}/api/storage-wizard/backup-events' -Method POST -ContentType 'application/json' -Body $evt -Headers $headers -TimeoutSec 5 | Out-Null`,
    `    }`,
    `  } catch {}`,
    `}" >nul 2>&1`,
  ];
  return lines.join('\n');
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
    `  if command -v curl >/dev/null 2>&1 && [[ -n "$_EVT_PASS" ]]; then`,
    `    _TOKEN="$(curl -sf --connect-timeout 5 -X POST "http://$_EVT_HOST:${port}/api/login" \\`,
    `      -H 'Content-Type: application/json' \\`,
    `      -d "{\\"username\\":\\"$_EVT_USER\\",\\"password\\":\\"$_EVT_PASS\\"}" 2>/dev/null \\`,
    `      | sed -n 's/.*"token":"\\([^"]*\\)".*/\\1/p' || true)"`,
    `    if [[ -n "$_TOKEN" ]]; then`,
    `      curl -sf --connect-timeout 5 -X POST "http://$_EVT_HOST:${port}/api/storage-wizard/backup-events" \\`,
    `        -H 'Content-Type: application/json' \\`,
    `        -H "Authorization: Bearer $_TOKEN" \\`,
    `        -d "{\\"backup_uuid\\":\\"$_EVT_UUID\\",\\"client_id\\":\\"$INSTALL_ID\\",\\"event_type\\":\\"$_EVT_TYPE\\",\\"status\\":\\"\${_BCAST_STATUS:-}\\",\\"error\\":\\"\${_BCAST_ERROR:-}\\"}" \\`,
    `        >/dev/null 2>&1 || true`,
    `    fi`,
    `  fi`,
    `) || true`,
  ];
  return lines.join('\n');
}
