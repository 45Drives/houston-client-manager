import { app, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';

const LOG_FILE_PREFIX = '45drives-storage-wizard-';

interface ParsedLogEntry {
  id: string;
  timestamp: string;
  level: string;
  event: string;
  summary: string;
  details?: string;
  source?: string;
  data?: Record<string, any>;
}

function normalizeLevel(raw: string | undefined): string {
  const l = (raw || '').toLowerCase();
  if (l === 'err' || l === 'error' || l === 'crit' || l === 'critical' || l === 'fatal') return 'error';
  if (l === 'warn' || l === 'warning') return 'warn';
  if (l === 'debug' || l === 'trace') return 'debug';
  return 'info';
}

function parseTextLogLine(line: string, index: number, source: string): ParsedLogEntry | null {
  if (!line || !line.trim()) return null;
  const trimmed = line.trim();

  // Backup script banner: ===== [timestamp] message =====
  const bannerMatch = trimmed.match(
    /^=+\s*\[(\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}[^\]]*)\]\s*(.*?)\s*=*$/,
  );
  if (bannerMatch) {
    const msg = bannerMatch[2];
    const isComplete = /completed/i.test(msg);
    return {
      id: `${source}-${index}`,
      timestamp: bannerMatch[1],
      level: 'info',
      event: isComplete ? 'Backup Completed' : 'Backup Started',
      summary: msg,
      source,
    };
  }

  // Backup script tagged lines: [SUCCESS], [INFO], [ERROR], [WARN], [CLEANUP]
  const tagMatch = trimmed.match(/^\[(SUCCESS|INFO|ERROR|WARN|CLEANUP)\]\s*(.*)/);
  if (tagMatch) {
    const tag = tagMatch[1];
    const msg = tagMatch[2];
    const level = tag === 'SUCCESS' ? 'info'
               : tag === 'ERROR' ? 'error'
               : tag === 'WARN' ? 'warn'
               : tag === 'CLEANUP' ? 'debug'
               : 'info';
    // Derive a short event from the message (first meaningful phrase)
    const event = msg.replace(/[:.].*/, '').trim() || tag;
    return {
      id: `${source}-${index}`,
      timestamp: '',
      level,
      event,
      summary: msg.slice(0, 200),
      details: msg.length > 200 ? msg : undefined,
      source,
    };
  }

  // Standard bracket format: [timestamp][LEVEL] message
  const bracketMatch = trimmed.match(
    /^\[(\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}[^\]]*)\]\s*\[(\w+)\]\s*(.*)/,
  );
  if (bracketMatch) {
    return {
      id: `${source}-${index}`,
      timestamp: bracketMatch[1],
      level: normalizeLevel(bracketMatch[2]),
      event: bracketMatch[3].replace(/[:.].*/, '').trim() || bracketMatch[2],
      summary: bracketMatch[3].slice(0, 200),
      details: bracketMatch[3].length > 200 ? bracketMatch[3] : undefined,
      source,
    };
  }

  // ISO timestamp format: timestamp LEVEL: message
  const isoMatch = trimmed.match(
    /^(\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}[^\s]*)\s+(\w+)[:\s]\s*(.*)/,
  );
  if (isoMatch) {
    return {
      id: `${source}-${index}`,
      timestamp: isoMatch[1],
      level: normalizeLevel(isoMatch[2]),
      event: isoMatch[3].replace(/[:.].*/, '').trim() || isoMatch[2],
      summary: isoMatch[3].slice(0, 200),
      details: isoMatch[3].length > 200 ? isoMatch[3] : undefined,
      source,
    };
  }

  return {
    id: `${source}-${index}`,
    timestamp: '',
    level: 'info',
    event: trimmed.replace(/[:.].*/, '').trim().slice(0, 60) || source,
    summary: trimmed.slice(0, 200),
    details: trimmed.length > 200 ? trimmed : undefined,
    source,
  };
}

function getLogDir(): string {
  return path.join(app.getPath('userData'), 'logs');
}

/** List available NDJSON log files, returning dates sorted newest-first */
function listLogDates(): { date: string; file: string }[] {
  const logDir = getLogDir();
  if (!fs.existsSync(logDir)) return [];

  return fs.readdirSync(logDir)
    .filter(f =>
      f.startsWith(LOG_FILE_PREFIX) &&
      f.endsWith('.json') &&
      !f.endsWith('.gz'),
    )
    .map(f => {
      const match = f.match(/(\d{4}-\d{2}-\d{2})\.json$/);
      return match ? { date: match[1], file: f } : null;
    })
    .filter((x): x is { date: string; file: string } => x !== null)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Read entries from a single NDJSON log file */
function readLogFile(filePath: string, limit: number): ParsedLogEntry[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  const entries: ParsedLogEntry[] = [];
  const fileName = path.basename(filePath);

  for (let i = 0; i < lines.length && entries.length < limit; i++) {
    try {
      const obj = JSON.parse(lines[i]);
      entries.push({
        id: `${fileName}-${i}`,
        timestamp: obj.timestamp || '',
        level: normalizeLevel(obj.level),
        event: obj.event || obj.message || '',
        summary: obj.message || obj.event || '',
        details: obj.stack || obj.error || undefined,
        data: obj,
        source: fileName,
      });
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

const BACKUP_EVENTS_FILE = '45drives_backup_events.json';

/** Read backup event entries from the NDJSON backup events log, optionally filtered by date */
function readBackupEvents(logDir: string, date: string | undefined, limit: number): ParsedLogEntry[] {
  const filePath = path.join(logDir, BACKUP_EVENTS_FILE);
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  const entries: ParsedLogEntry[] = [];

  for (let i = 0; i < lines.length && entries.length < limit; i++) {
    try {
      const obj = JSON.parse(lines[i]);
      const ts = obj.timestamp || '';

      // If filtering by date, only include entries from that day
      if (date && ts && !ts.startsWith(date)) continue;

      const event = obj.event || 'backup_event';
      const status = obj.status || '';
      const level = (event === 'backup_fail' || status === 'fail') ? 'error'
                  : (event === 'backup_end' || status === 'success') ? 'info'
                  : 'info';

      const parts = [event];
      if (obj.uuid) parts.push(`uuid=${obj.uuid}`);
      if (obj.host) parts.push(`host=${obj.host}`);
      if (obj.share) parts.push(`share=${obj.share}`);
      const summary = parts.join(' ');

      entries.push({
        id: `backup-event-${i}`,
        timestamp: ts,
        level,
        event,
        summary,
        details: obj.error || obj.stderr || undefined,
        data: obj,
        source: BACKUP_EVENTS_FILE,
      });
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

/**
 * Register IPC handlers for reading log files.
 *
 * Handlers:
 *   'logs:list-client-files' — list available log dates for client dropdown
 *   'logs:read-client'       — read client log entries (optionally for a specific date)
 *   'logs:read-server'       — fetch server logs from broadcaster API
 *   'logs:read-backup-task'  — read per-task backup log file
 */
export function registerLogHandlers(
  assertMainWindowSender: (event: Electron.IpcMainInvokeEvent) => void,
) {
  // ── List available client log dates ─────────────────────────────
  ipcMain.handle(
    'logs:list-client-files',
    async (event) => {
      assertMainWindowSender(event);
      const dates = listLogDates();
      return { ok: true, dates, logDir: getLogDir() };
    },
  );

  // ── Client logs ────────────────────────────────────────────────────
  ipcMain.handle(
    'logs:read-client',
    async (event, opts?: { date?: string; limit?: number }) => {
      assertMainWindowSender(event);

      const limit = Math.min(Math.max(opts?.limit ?? 2000, 1), 10000);
      const logDir = getLogDir();

      try {
        if (!fs.existsSync(logDir)) {
          return { ok: true, entries: [], file: '', logDir, message: 'Log directory does not exist yet.' };
        }

        const available = listLogDates();
        if (available.length === 0) {
          return { ok: true, entries: [], file: '', logDir, message: 'No log files found.' };
        }

        // If a date is specified, use that file; otherwise use the most recent
        let targetFile: string;
        let targetDate: string;
        if (opts?.date && /^\d{4}-\d{2}-\d{2}$/.test(opts.date)) {
          const match = available.find(a => a.date === opts.date);
          if (!match) {
            return { ok: true, entries: [], file: '', logDir, message: `No log file for date ${opts.date}.` };
          }
          targetFile = match.file;
          targetDate = match.date;
        } else {
          targetFile = available[0].file;
          targetDate = available[0].date;
        }

        const filePath = path.join(logDir, targetFile);
        const entries = readLogFile(filePath, limit);

        // Also include backup event entries for the selected date
        const backupEntries = readBackupEvents(logDir, targetDate, limit);
        entries.push(...backupEntries);

        // Sort newest first
        entries.sort((a, b) => {
          const ta = new Date(a.timestamp).getTime() || 0;
          const tb = new Date(b.timestamp).getTime() || 0;
          return tb - ta;
        });

        return {
          ok: true,
          entries: entries.slice(0, limit),
          file: targetFile,
          date: targetDate,
          logDir,
        };
      } catch (e: any) {
        return { ok: false, error: e?.message || String(e), entries: [], file: '', logDir };
      }
    },
  );

  // ── Server logs (fetched from broadcaster API via main process) ───
  ipcMain.handle(
    'logs:read-server',
    async (
      event,
      opts?: { ip?: string; source?: string; limit?: number },
    ) => {
      assertMainWindowSender(event);

      const ip = opts?.ip;
      if (!ip) {
        return { ok: false, error: 'No server IP provided', entries: [], files: [] };
      }

      const source = opts?.source || 'all';
      const limit = Math.min(Math.max(opts?.limit ?? 500, 1), 5000);

      try {
        const url = `http://${ip}:9099/logs?source=${encodeURIComponent(source)}&limit=${limit}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);

        const resp = await fetch(url, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!resp.ok) {
          return {
            ok: false,
            error: `Server returned ${resp.status}: ${resp.statusText}`,
            entries: [],
            files: [],
          };
        }

        const data = await resp.json();
        if (!data?.ok) {
          return {
            ok: false,
            error: data?.error || 'Server returned an error',
            entries: [],
            files: data?.files || [],
          };
        }

        return {
          ok: true,
          entries: Array.isArray(data.entries) ? data.entries : [],
          files: Array.isArray(data.files) ? data.files : [],
        };
      } catch (e: any) {
        const msg =
          e?.name === 'AbortError'
            ? 'Request timed out connecting to server'
            : e?.message || String(e);
        return { ok: false, error: msg, entries: [], files: [] };
      }
    },
  );

  // ── Backup task log (per-task .log file) ──────────────────────────
  ipcMain.handle(
    'logs:read-backup-task',
    async (event, opts?: { uuid?: string; limit?: number }) => {
      assertMainWindowSender(event);

      const uuid = opts?.uuid;
      if (!uuid || !/^[a-zA-Z0-9_-]+$/.test(uuid)) {
        return { ok: false, error: 'Invalid or missing task UUID', entries: [], file: '' };
      }

      const limit = Math.min(Math.max(opts?.limit ?? 500, 1), 5000);
      const logDir = getLogDir();

      try {
        if (!fs.existsSync(logDir)) {
          return { ok: true, entries: [], file: '', logDir, message: 'Log directory does not exist yet.' };
        }

        // Try both naming conventions
        const candidates = [
          `Houston_Backup_Task_${uuid}.log`,
          `backup_task_${uuid}.log`,
        ];

        let logFile: string | null = null;
        for (const name of candidates) {
          const full = path.join(logDir, name);
          if (fs.existsSync(full)) { logFile = full; break; }
        }

        if (!logFile) {
          return { ok: true, entries: [], file: '', logDir, message: 'No log file found for this task.' };
        }

        const content = fs.readFileSync(logFile, 'utf-8');
        const lines = content.split('\n').filter((l) => l.trim());
        const fileName = path.basename(logFile);

        const entries: ParsedLogEntry[] = [];
        for (let i = 0; i < lines.length && entries.length < limit; i++) {
          const parsed = parseTextLogLine(lines[i], i, fileName);
          if (parsed) entries.push(parsed);
        }

        // newest first
        entries.sort((a, b) => {
          const ta = new Date(a.timestamp).getTime() || 0;
          const tb = new Date(b.timestamp).getTime() || 0;
          return tb - ta;
        });

        return { ok: true, entries: entries.slice(0, limit), file: fileName, logDir };
      } catch (e: any) {
        return { ok: false, error: e?.message || String(e), entries: [], file: '' };
      }
    },
  );
}
