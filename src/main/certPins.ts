// src/main/security/certPins.ts
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

type Pin = { host: string; fingerprint: string; addedAt: number };
type PinMap = Record<string, Pin>;

const pinsPath = path.join(app.getPath('userData'), 'cert-pins.json');

function readPins(): PinMap {
    try {
        const txt = fs.readFileSync(pinsPath, 'utf8');
        return JSON.parse(txt) as PinMap;
    } catch { return {}; }
}

function writePins(pins: PinMap) {
    fs.mkdirSync(path.dirname(pinsPath), { recursive: true });
    fs.writeFileSync(pinsPath, JSON.stringify(pins, null, 2), 'utf8');
}

export function getPin(host: string): Pin | undefined {
    const pins = readPins();
    return pins[host];
}

export function isHostPinned(host: string, fp: string): boolean {
    const p = getPin(host);
    return !!p && p.fingerprint === fp;
}

export function rememberPin(host: string, fp: string) {
    const pins = readPins();
    pins[host] = { host, fingerprint: fp, addedAt: Date.now() };
    writePins(pins);
}

export function forgetPin(host: string) {
    const pins = readPins();
    if (pins[host]) {
        delete pins[host];
        writePins(pins);
    }
}
