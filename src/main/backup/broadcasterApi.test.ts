// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('electron', () => ({ app: { getPath: () => '/unused' } }));
vi.mock('@45drives/houston-common-lib', () => ({}));
import { bashEventSnippet, bashEventSnippetMac, batchEventSnippet } from './broadcasterApi';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    for (const filename of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, filename));
    fs.rmdirSync(directory);
  }
});

describe('scoped backup-event scripts', () => {
  it.each(['linux', 'mac'])('binds %s reporting to the install and safely encodes credentials/events', platform => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-reporting-'));
    directories.push(directory);
    fs.writeFileSync(path.join(directory, 'curl'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const body = JSON.parse(fs.readFileSync(0, 'utf8'));
const login = args.some(arg => arg.endsWith('/api/login'));
const header = login ? null : fs.readFileSync(3, 'utf8');
fs.appendFileSync(process.env.CAPTURE_FILE, JSON.stringify({args, body, header}) + '\\n');
if (login) process.stdout.write('{"token":"fixture-token"}');
`, { mode: 0o700 });
    fs.writeFileSync(path.join(directory, 'security'), '#!/bin/bash\nprintf \'%s\' "$FIXTURE_PASSWORD"\n', { mode: 0o700 });
    const password = 'quote" slash\\ dollar$ backtick` unicode\u00e9';
    const error = 'failed "file"\\path\nnext\tline\u0001';
    const credentials = path.join(directory, 'credential');
    fs.writeFileSync(credentials, `username=alice\npassword=${password}\n`, { mode: 0o600 });
    const snippet = platform === 'linux'
      ? bashEventSnippet('192.0.2.1', 'end', 'backup-a')
      : bashEventSnippetMac('192.0.2.1', 'end', 'backup-a', 'keychain-service', 'alice');
    const script = path.join(directory, 'report.sh');
    fs.writeFileSync(script, snippet);
    execFileSync('bash', ['-n', script]);
    const capture = path.join(directory, 'requests');
    execFileSync('bash', [script], {
      env: {
        ...process.env, PATH: `${directory}:${process.env.PATH}`, CAPTURE_FILE: capture,
        SMB_USER: 'alice', CRED_FILE: credentials, INSTALL_ID: 'client-a', FIXTURE_PASSWORD: password,
        _BCAST_STATUS: 'failed', _BCAST_ERROR: error,
      },
    });
    const calls = fs.readFileSync(capture, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(calls).toHaveLength(2);
    expect(calls[0].body).toEqual({ username: 'alice', password, clientId: 'client-a' });
    expect(calls[1].body).toEqual({
      backup_uuid: 'backup-a', client_id: 'client-a', event_type: 'end', status: 'failed', error,
    });
    expect(calls[1].header).toBe('Authorization: Bearer fixture-token\n');
    for (const call of calls) {
      expect(call.args.join(' ')).not.toContain(password);
      expect(call.args.join(' ')).not.toContain('fixture-token');
    }
  });

  it('binds Windows login and reporting to the same delayed-expansion install ID', () => {
    const script = batchEventSnippet('192.0.2.1', 'end', 'backup-a');
    expect(script).toContain("password=$cred['password']; clientId='!INSTALL_ID!'");
    expect(script).toContain("client_id='!INSTALL_ID!'");
  });
});
