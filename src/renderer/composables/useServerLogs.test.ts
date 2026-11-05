import { beforeEach, describe, expect, it, vi } from "vitest";
import { readServerLogs } from "./useServerLogs";
import { useServerCredentials } from "./useServerCredentials";

const query = { ip: "192.168.1.20", source: "all", limit: 100 };
let invoke: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useServerCredentials().clearCredentials();
  invoke = vi.fn();
  (window as any).electron = { ipcRenderer: { invoke } };
});

describe("readServerLogs", () => {
  it("reads without a login when the server does not ask for one (older broadcasters)", async () => {
    invoke.mockResolvedValueOnce({ ok: true, entries: [1] });
    const ask = vi.fn();
    await expect(readServerLogs(query, ask)).resolves.toEqual({ ok: true, entries: [1] });
    expect(invoke).toHaveBeenCalledWith("logs:read-server", query);
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks for a login once and retries with it", async () => {
    invoke
      .mockResolvedValueOnce({ ok: false, needsLogin: true, error: "Sign in to the server to read its logs." })
      .mockResolvedValueOnce({ ok: true, entries: [] });
    const ask = vi.fn().mockResolvedValue({ username: "admin", password: "pw" });
    await expect(readServerLogs(query, ask)).resolves.toEqual({ ok: true, entries: [] });
    expect(ask).toHaveBeenCalledWith("Sign in to the server to read its logs.");
    expect(invoke).toHaveBeenLastCalledWith("logs:read-server", { ...query, username: "admin", password: "pw" });
  });

  it("uses credentials this session already has for the server before asking", async () => {
    useServerCredentials().setCredentials(query.ip, "root", "known");
    invoke
      .mockResolvedValueOnce({ ok: false, needsLogin: true })
      .mockResolvedValueOnce({ ok: true, entries: [] });
    const ask = vi.fn();
    await readServerLogs(query, ask);
    expect(invoke).toHaveBeenLastCalledWith("logs:read-server", { ...query, username: "root", password: "known" });
    expect(ask).not.toHaveBeenCalled();
  });

  it("does not retry when the user cancels the login", async () => {
    invoke.mockResolvedValueOnce({ ok: false, needsLogin: true });
    const res = await readServerLogs(query, vi.fn().mockResolvedValue(null));
    expect(res).toMatchObject({ ok: false, needsLogin: true });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("reports a failed sign-in without asking again", async () => {
    invoke
      .mockResolvedValueOnce({ ok: false, needsLogin: true })
      .mockResolvedValueOnce({ ok: false, needsLogin: true, error: "Sign-in failed." });
    const ask = vi.fn().mockResolvedValue({ username: "admin", password: "wrong" });
    await expect(readServerLogs(query, ask)).resolves.toMatchObject({ ok: false, error: "Sign-in failed." });
    expect(ask).toHaveBeenCalledTimes(1);
  });
});
