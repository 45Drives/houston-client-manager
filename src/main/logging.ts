import { jsonLogger } from './main';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Structured event log. Safe to call before the Winston logger exists
 * (anything during early startup falls back to the console).
 */
export function logEvent(
  event: string,
  data: Record<string, unknown> = {},
  level: LogLevel = 'info'
): void {
  const payload = { event, ...data };
  if (!jsonLogger) {
    console.log(JSON.stringify(payload));
    return;
  }
  (jsonLogger as any)[level](payload);
}

/**
 * Wraps an async operation with start/done/error entries and a duration.
 * Re-throws so callers keep their existing error handling.
 */
export async function logStep<T>(
  event: string,
  data: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  logEvent(event, data);
  try {
    const result = await fn();
    logEvent(`${event}.done`, { ...data, durationMs: Date.now() - startedAt });
    return result;
  } catch (err) {
    logEvent(
      `${event}.error`,
      { ...data, durationMs: Date.now() - startedAt, error: errMsg(err) },
      'error'
    );
    throw err;
  }
}
