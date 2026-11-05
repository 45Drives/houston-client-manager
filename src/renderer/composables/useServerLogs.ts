// useServerLogs.ts
import { useServerCredentials } from "./useServerCredentials";

type Login = { username: string; password: string };

export type ServerLogsResult = {
  ok: boolean;
  entries?: unknown[];
  files?: string[];
  error?: string;
  needsLogin?: boolean;
};

const SIGN_IN_MESSAGE = "Sign in to the server to read its logs.";

/**
 * Read broadcaster setup logs. Current broadcasters need an administrator login for these:
 * reuse credentials this session already has for the server, otherwise ask once.
 */
export async function readServerLogs(
  query: { ip: string; source: string; limit: number },
  askForLogin: (message: string) => Promise<Login | null>,
): Promise<ServerLogsResult> {
  const read = (login?: Login): Promise<ServerLogsResult> =>
    window.electron?.ipcRenderer.invoke("logs:read-server", { ...query, ...login });

  let res = await read();
  if (!res?.needsLogin) return res;

  const known = useServerCredentials().getCredentials(query.ip);
  if (known?.username && known.password) {
    res = await read(known);
    if (!res?.needsLogin) return res;
  }

  const login = await askForLogin(res?.error || SIGN_IN_MESSAGE);
  if (!login) return { ok: false, needsLogin: true, error: SIGN_IN_MESSAGE, entries: [], files: [] };
  return read(login);
}
