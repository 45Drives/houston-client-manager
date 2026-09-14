import { jsonLogger } from './main';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * `fetch` and ssh2 both throw errors whose message alone is useless
 * ("fetch failed", "Timed out while waiting for handshake"); the actionable
 * syscall code lives on `.code`, `.cause.code` or ssh2's `.level`.
 */
export function errDetail(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { error: String(err) };
  const cause = (err as { cause?: unknown }).cause;
  return {
    error: err.message,
    errorName: err.name,
    ...((err as NodeJS.ErrnoException).code && { code: (err as NodeJS.ErrnoException).code }),
    ...((err as { level?: string }).level && { level: (err as { level?: string }).level }),
    ...(cause instanceof Error && {
      cause: cause.message,
      ...((cause as NodeJS.ErrnoException).code && { causeCode: (cause as NodeJS.ErrnoException).code }),
    }),
  };
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
