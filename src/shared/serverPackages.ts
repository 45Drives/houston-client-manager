/**
 * 45Drives packages the Storage Wizard drives from the community repo.
 *
 * `minVersion` is the oldest server-side version this client works with. When a
 * server has an older one installed it is upgraded during the connect/setup step,
 * the same as a missing package. Bump it when the client starts depending on a
 * new server-side feature. Omit it to only install the package when it is absent.
 *
 * The build number is optional. "1.7.7" matches any 1.7.7 build; "1.7.7-4"
 * additionally requires build 4 or later. Both forms work across rpm and deb,
 * whose distro suffixes ("1.7.7-4.el8", "1.7.7-4focal") are ignored.
 */
export interface HoustonPackage {
  /** Package name in the 45Drives community repo (same on rpm and deb). */
  name: string;
  /** Name shown to the user in progress and error messages. */
  label: string;
  /** Oldest supported version, "1.7.7" or "1.7.7-4"; undefined means any. */
  minVersion?: string;
}

export const HOUSTON_PACKAGES: readonly HoustonPackage[] = [
  { name: 'houston-broadcaster', label: 'Houston Broadcaster', minVersion: '2.3.5-1' },
  { name: 'cockpit-super-simple-setup', label: 'Super Simple Setup', minVersion: '1.2.1-2' },
  { name: 'cockpit-scheduler', label: 'Task Scheduler', minVersion: '1.7.8-1' },
  { name: 'wireshield', label: 'WireShield', minVersion: '0.1.8' },
  { name: 'cockpit-zfs', label: 'ZFS Management' },
];

export const HOUSTON_PACKAGE_NAMES: readonly string[] = HOUSTON_PACKAGES.map((p) => p.name);

export function getHoustonPackage(name: string): HoustonPackage | undefined {
  return HOUSTON_PACKAGES.find((p) => p.name === name);
}

/** Human-readable label for a package name, falling back to the name itself. */
export function houstonPackageLabel(name: string): string {
  return getHoustonPackage(name)?.label ?? name;
}

/**
 * Splits an rpm/deb version into comparable segments, dropping the epoch.
 * Separators are discarded and digit/letter runs are split apart, so the
 * distro suffixes 45Drives appends to the build number ("4.el8", "4focal",
 * "4bookworm") all reduce to a leading 4 that compares numerically.
 */
function segments(version: string): string[] {
  return version.trim().replace(/^\d+:/, '').match(/\d+|[a-zA-Z]+/g) ?? [];
}

/** Returns -1, 0 or 1 comparing two rpm/deb version strings. */
export function compareVersions(a: string, b: string): number {
  const sa = segments(a);
  const sb = segments(b);
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    const x = sa[i];
    const y = sb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isInteger(nx) && Number.isInteger(ny)) {
      if (nx !== ny) return nx < ny ? -1 : 1;
    } else {
      const c = x.localeCompare(y, 'en');
      if (c !== 0) return c < 0 ? -1 : 1;
    }
  }
  return 0;
}

/** True when `installed` is older than `minimum`. */
export function isOlderThan(installed: string, minimum: string): boolean {
  return compareVersions(installed, minimum) < 0;
}

/** True when `installed` is older than the package's declared minimum. */
export function isBelowMinimum(name: string, installed: string | undefined): boolean {
  const min = getHoustonPackage(name)?.minVersion;
  if (!min || !installed) return false;
  return isOlderThan(installed, min);
}
