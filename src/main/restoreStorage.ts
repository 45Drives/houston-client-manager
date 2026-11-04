import type { NodeSSH } from 'node-ssh';
import { shellQuote } from './security';

export interface RestoreDestination {
  name: string;
  mountpoint: string;
  available: number;
}

// Runs on the server: configured mountpoints alone do not prove that ZFS is mounted.
export const restoreStorageScript = String.raw`
import json, os, pathlib, re, sys

def fail(message):
    raise ValueError(message + ". Choose a mounted, writable ZFS data dataset (not the OS filesystem), or mount the dataset and retry")

def unescape(value):
    return re.sub(r'\\([0-7]{3})', lambda m: chr(int(m.group(1), 8)), value)

def mounts():
    result = []
    with open('/proc/self/mountinfo') as entries:
        for line in entries:
            left, right = line.rstrip('\n').split(' - ', 1)
            fields, fs = left.split(), right.split()
            result.append({
                'target': unescape(fields[4]), 'device': fields[2],
                'readonly': 'ro' in fields[5].split(',') or 'ro' in fs[2].split(','),
                'fstype': fs[0], 'source': unescape(fs[1]),
            })
    return result

def backing(p, table):
    candidates = [m for m in table if p == m['target'] or p.startswith(m['target'].rstrip('/') + '/')]
    if not candidates:
        fail("Cannot determine the backing filesystem for " + p)
    return max(candidates, key=lambda m: len(m['target']))

def checked(p, table):
    m = backing(p, table)
    root = backing('/', table)
    if m['readonly']:
        fail("Restore destination is on a read-only filesystem: " + p)
    if not allow_non_zfs and (m['fstype'] != 'zfs' or m['target'] == '/' or m['source'] == root['source']):
        fail("Restore destination " + p + " is not on mounted, writable ZFS data storage")
    return m

def canonical(p):
    if not p or '\0' in p or not os.path.isabs(p):
        fail("Restore destination must be an absolute server path")
    return str(pathlib.Path(p).resolve())

def ancestor(p):
    while not os.path.exists(p):
        parent = os.path.dirname(p)
        if parent == p:
            fail("Cannot resolve restore destination")
        p = parent
    return p

def check_device(p, m):
    dev = os.stat(p).st_dev
    if str(os.major(dev)) + ':' + str(os.minor(dev)) != m['device']:
        fail("The ZFS mount changed while checking " + p)

def validate(p, table, tree=True):
    p = canonical(p)
    existing = ancestor(p)
    m = checked(existing, table)
    check_device(existing, m)
    if not os.path.isdir(existing):
        fail("Restore destination is not a directory: " + existing)
    if tree and os.path.exists(p):
        pending, seen = [p], set()
        while pending:
            directory = pending.pop()
            real = canonical(directory)
            if real in seen:
                continue
            seen.add(real)
            check_device(real, checked(real, table))
            with os.scandir(real) as entries:
                for entry in entries:
                    resolved = canonical(entry.path)
                    check_device(ancestor(resolved), checked(ancestor(resolved), table))
                    if entry.is_dir():
                        pending.append(resolved)
    return p, existing, m

try:
    mode = sys.argv[1]
    allow_non_zfs = mode.endswith('-custom')
    if allow_non_zfs:
        mode = mode[:-7]
    table = mounts()
    if mode == 'list':
        roots = []
        root = backing('/', table)
        for m in table:
            if m['fstype'] != 'zfs' or m['target'] == '/' or m['source'] == root['source'] or m['readonly']:
                continue
            p, existing, _ = validate(m['target'], table, tree=False)
            if p != m['target'] or existing != p:
                fail("ZFS mountpoint is not accessible: " + m['target'])
            space = os.statvfs(p)
            roots.append({'name': m['source'], 'mountpoint': p, 'available': space.f_bavail * space.f_frsize})
        if not roots:
            fail("No mounted, writable ZFS data datasets are available")
        print(json.dumps(sorted(roots, key=lambda r: r['available'], reverse=True)))
    else:
        p, existing, m = validate(sys.argv[2], table)
        if mode in ('prepare', 'run'):
            # Pin the mounted ancestor before mkdir; relative writes cannot fall through
            # to the root filesystem if this mount is subsequently detached.
            fd = os.open(existing, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fchdir(fd)
            finally:
                os.close(fd)
            check_device('.', m)
            relative = os.path.relpath(p, existing)
            os.makedirs(relative, exist_ok=True)
            os.chdir(relative)
            check_device('.', checked(p, mounts()))
        if mode == 'run':
            os.environ['TMPDIR'] = '.'
            os.execvp('/bin/sh', ['/bin/sh', '-c', sys.argv[3]])
        else:
            print(json.dumps(p))
except (OSError, ValueError, RuntimeError) as error:
    print("Restore storage validation failed: " + str(error) +
          ". Check the path, permissions, and mounted ZFS data storage before retrying", file=sys.stderr)
    sys.exit(1)
`;

function storageCommand(mode: string, args: string[] = [], sudo = false): string {
  return `${sudo ? 'sudo ' : ''}python3 -c ${shellQuote(restoreStorageScript)} ${[mode, ...args].map(shellQuote).join(' ')}`;
}

async function storageResult(ssh: NodeSSH, command: string): Promise<unknown> {
  const result = await ssh.execCommand(command);
  if (result.code !== 0) {
    throw new Error(
      (result.stderr || result.stdout).trim() ||
      'Cannot validate restore storage. Check SSH access, Python 3, and mounted ZFS data datasets on the server.',
    );
  }
  return JSON.parse(result.stdout);
}

export async function listMountedRestoreDestinations(ssh: NodeSSH): Promise<RestoreDestination[]> {
  const result = await storageResult(ssh, storageCommand('list'));
  if (!Array.isArray(result) || !result.length || !result.every(
    r => typeof r.name === 'string' && typeof r.mountpoint === 'string' &&
      r.mountpoint.startsWith('/') && typeof r.available === 'number',
  )) {
    throw new Error('Invalid mounted ZFS destination response from server.');
  }
  return result;
}

export async function validateServerRestoreDestination(ssh: NodeSSH, destination: string): Promise<string> {
  const result = await storageResult(ssh, storageCommand('validate', [destination]));
  if (typeof result !== 'string' || !result.startsWith('/')) {
    throw new Error('Invalid validated restore destination response from server.');
  }
  return result;
}

export async function prepareServerRestoreDirectory(ssh: NodeSSH, destination: string, allowNonZfs = false): Promise<string> {
  const result = await storageResult(ssh, storageCommand(allowNonZfs === true ? 'prepare-custom' : 'prepare', [destination]));
  if (typeof result !== 'string' || !result.startsWith('/')) {
    throw new Error('Invalid prepared restore directory response from server.');
  }
  return result;
}

/** command must write to "." (the validated directory), never the original absolute path. */
export function serverRestoreCommand(destination: string, command: string, sudo = false, allowNonZfs = false): string {
  return storageCommand(allowNonZfs === true ? 'run-custom' : 'run', [destination, command], sudo);
}
