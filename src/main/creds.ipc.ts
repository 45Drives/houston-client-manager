import * as fs from 'fs';
import * as path from 'path';
import { App, IpcMain } from 'electron';
import keytar from 'keytar';
import { SavedServer } from './types';

const SERVICE = 'com.45drives.houston.server';

export function registerCredsIPC(ipcMain: IpcMain, app: App) {
    const dbPath = path.join(app.getPath('userData'), 'servers.json');

    const readDb = (): SavedServer[] => {
        try { return JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch { return []; }
    };
    const writeDb = (rows: SavedServer[]) => {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        fs.writeFileSync(dbPath, JSON.stringify(rows, null, 2));
    };

    ipcMain.handle('cred:list-servers', () => readDb());

    ipcMain.handle('cred:get-for', async (_e, host: string) => {
        const rows = readDb().filter(r => r.host === host);
        const meta = rows.sort((a, b) =>
            (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || (b.lastUsedAt || 0) - (a.lastUsedAt || 0)
        )[0];
        if (!meta) return null;
        const secret = await keytar.getPassword(SERVICE, meta.id);
        if (!secret) return null;
        return { id: meta.id, username: meta.username, password: secret };
    });

    ipcMain.handle('cred:save', async (_e, p: { host: string; name?: string; username: string; password: string; favorite?: boolean }) => {
        const id = `${p.host}|${p.username}`;
        const rows = readDb().filter(r => r.id !== id);
        rows.push({ id, host: p.host, name: p.name, username: p.username, favorite: !!p.favorite, lastUsedAt: Date.now() });
        writeDb(rows);
        await keytar.setPassword(SERVICE, id, p.password);
        return { ok: true, id };
    });

    ipcMain.handle('cred:remove', async (_e, id: string) => {
        const rows = readDb().filter(r => r.id !== id);
        writeDb(rows);
        await keytar.deletePassword(SERVICE, id);
        return { ok: true };
    });

    ipcMain.handle('cred:set-favorite', (_e, id: string, fav: boolean) => {
        const rows = readDb().map(r => r.id === id ? { ...r, favorite: fav } : r);
        writeDb(rows);
        return { ok: true };
    });

    ipcMain.handle('cred:touch', (_e, id: string) => {
        const rows = readDb().map(r => r.id === id ? { ...r, lastUsedAt: Date.now() } : r);
        writeDb(rows);
        return { ok: true };
    });
}