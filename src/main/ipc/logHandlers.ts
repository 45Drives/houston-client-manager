import { app, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';

/**
 * Register IPC handlers for reading local client log files.
 *
 * Log files are NDJSON (one JSON object per line) written by Winston DailyRotateFile:
 *   <userData>/logs/45drives-setup-wizard-YYYY-MM-DD.json
 *
 * Handler: 'logs:read-client'
 *   Input:  { limit?: number }
 *   Output: { ok, entries, file, logDir } | { ok: false, error }
 */
export function registerLogHandlers(
  assertMainWindowSender: (event: Electron.IpcMainInvokeEvent) => void,
) {
  ipcMain.handle(
    'logs:read-client',
    async (event, opts?: { limit?: number }) => {
      assertMainWindowSender(event);

      const limit = Math.min(Math.max(opts?.limit ?? 500, 1), 5000);
      const logDir = path.join(app.getPath('userData'), 'logs');

      try {
        if (!fs.existsSync(logDir)) {
          return { ok: true, entries: [], file: '', logDir, message: 'Log directory does not exist yet.' };
        }

        // Find all daily-rotated JSON log files (not .gz archives)
        const allFiles = fs.readdirSync(logDir);
        const logFiles = allFiles
          .filter(
            (f) =>
              f.startsWith('45drives-setup-wizard-') &&
              f.endsWith('.json') &&
              !f.endsWith('.gz'),
          )
          .sort()
          .reverse(); // Most recent first

        if (logFiles.length === 0) {
          return { ok: true, entries: [], file: '', logDir, message: 'No log files found.' };
        }

        const entries: ParsedLogEntry[] = [];
        let filesRead = '';

        for (const file of logFiles) {
          if (entries.length >= limit) break;
          const filePath = path.join(logDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.split('\n').filter((l) => l.trim());

          for (let i = 0; i < lines.length; i++) {
            try {
              const obj = JSON.parse(lines[i]);
              entries.push({
                id: `${file}-${i}`,
                timestamp: obj.timestamp || '',
                level: normalizeLevel(obj.level),
                event: obj.event || obj.message || '',
                summary: obj.message || obj.event || '',
                details: obj.stack || obj.error || undefined,
                data: obj,
              });
            } catch {
              // Skip malformed lines
            }
          }
          if (!filesRead) filesRead = file;
        }

        // Sort newest first, then limit
        entries.sort((a, b) => {
          const ta = new Date(a.timestamp).getTime() || 0;
          const tb = new Date(b.timestamp).getTime() || 0;
          return tb - ta;
        });

        return {
          ok: true,
          entries: entries.slice(0, limit),
          file: filesRead,
          logDir,
        };
      } catch (e: any) {
        return { ok: false, error: e?.message || String(e), entries: [], file: '', logDir };
      }
    },
  );
}

interface ParsedLogEntry {
  id: string;
  timestamp: string;
  level: string;
  event: string;
  summary: string;
  details?: string;
  data?: Record<string, any>;
}

function normalizeLevel(raw: string | undefined): string {
  const l = (raw || '').toLowerCase();
  if (l === 'err' || l === 'error' || l === 'crit' || l === 'critical' || l === 'fatal') return 'error';
  if (l === 'warn' || l === 'warning') return 'warn';
  if (l === 'debug' || l === 'trace') return 'debug';
  return 'info';
}
