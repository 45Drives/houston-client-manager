import { describe, it, expect } from 'vitest';
import {
  compareVersions,
  isOlderThan,
  isBelowMinimum,
  HOUSTON_PACKAGES,
} from './serverPackages';

// Version-specific cases use literals so bumping HOUSTON_PACKAGES cannot break them.
describe('compareVersions', () => {
  it('ignores the rpm/deb release suffix', () => {
    expect(compareVersions('1.7.7-4', '1.7.7')).toBe(1);
    expect(compareVersions('1.2.0-5.el8', '1.2.0')).toBe(1);
  });

  it('strips the epoch', () => {
    expect(compareVersions('1:2.3.5', '2.3.5')).toBe(0);
  });

  it('compares segments numerically, not lexically', () => {
    expect(compareVersions('0.1.10', '0.1.7')).toBe(1);
    expect(compareVersions('10.0.0', '9.9.9')).toBe(1);
  });

  it('detects older versions', () => {
    expect(compareVersions('1.7.6-9', '1.7.7')).toBe(-1);
    expect(compareVersions('2.3.4-12', '2.3.5')).toBe(-1);
  });

  it('treats identical versions as equal', () => {
    expect(compareVersions('0.1.7', '0.1.7')).toBe(0);
  });

  it('compares build numbers when the minimum specifies one', () => {
    expect(compareVersions('1.7.7-3', '1.7.7-4')).toBe(-1);
    expect(compareVersions('1.7.7-4', '1.7.7-4')).toBe(0);
    expect(compareVersions('1.7.7-5', '1.7.7-4')).toBe(1);
  });

  it('ignores the distro suffix on the build number', () => {
    for (const installed of ['1.7.7-4.el8', '1.7.7-4.el9', '1.7.7-4focal', '1.7.7-4bookworm']) {
      expect(compareVersions(installed, '1.7.7-4')).toBe(1);
      expect(compareVersions(installed, '1.7.7-5')).toBe(-1);
    }
  });

  it('compares a suffixed build number numerically, not lexically', () => {
    expect(compareVersions('1.7.7-10focal', '1.7.7-4')).toBe(1);
    expect(compareVersions('1.7.7-10.el8', '1.7.7-9')).toBe(1);
  });
});

describe('isOlderThan', () => {
  it('flags an older upstream version', () => {
    expect(isOlderThan('1.7.6-9', '1.7.7-4')).toBe(true);
  });

  it('flags an older build of the same version', () => {
    expect(isOlderThan('1.7.7-3.el8', '1.7.7-4')).toBe(true);
    expect(isOlderThan('1.7.7-3focal', '1.7.7-4')).toBe(true);
  });

  it('accepts the exact minimum on every distro', () => {
    for (const installed of ['1.7.7-4', '1.7.7-4.el8', '1.7.7-4.el9', '1.7.7-4focal', '1.7.7-4bookworm']) {
      expect(isOlderThan(installed, '1.7.7-4')).toBe(false);
    }
  });

  it('accepts anything newer', () => {
    expect(isOlderThan('1.7.7-5', '1.7.7-4')).toBe(false);
    expect(isOlderThan('1.8.0-1', '1.7.7-4')).toBe(false);
  });
});

// Table-driven so the assertions hold whatever the declared minimums are.
describe('isBelowMinimum', () => {
  const gated = HOUSTON_PACKAGES.filter((p) => p.minVersion);
  const ungated = HOUSTON_PACKAGES.filter((p) => !p.minVersion);

  /** Decrements the last non-zero number, e.g. "1.7.7-5" -> "1.7.7-4". */
  function previousVersion(version: string): string {
    const numbers = [...version.matchAll(/\d+/g)];
    for (let i = numbers.length - 1; i >= 0; i--) {
      const match = numbers[i];
      const value = Number(match[0]);
      if (value === 0) continue;
      return version.slice(0, match.index) + (value - 1) + version.slice(match.index + match[0].length);
    }
    throw new Error(`No version exists below ${version}`);
  }

  /** Increments the last number, e.g. "1.7.7-5" -> "1.7.7-6". */
  function nextVersion(version: string): string {
    const match = [...version.matchAll(/\d+/g)].pop()!;
    return version.slice(0, match.index) + (Number(match[0]) + 1) + version.slice(match.index + match[0].length);
  }

  it('gates at least one package', () => {
    expect(gated.length).toBeGreaterThan(0);
  });

  it.each(gated)('accepts $name at exactly its declared minimum', ({ name, minVersion }) => {
    expect(isBelowMinimum(name, minVersion)).toBe(false);
  });

  it.each(gated)('accepts $name with a distro suffix on the minimum', ({ name, minVersion }) => {
    for (const suffix of ['.el8', '.el9', 'focal', 'bookworm']) {
      expect(isBelowMinimum(name, `${minVersion}${suffix}`)).toBe(false);
    }
  });

  it.each(gated)('accepts $name one build above its minimum', ({ name, minVersion }) => {
    expect(isBelowMinimum(name, nextVersion(minVersion!))).toBe(false);
  });

  it.each(gated)('flags $name one build below its minimum', ({ name, minVersion }) => {
    expect(isBelowMinimum(name, previousVersion(minVersion!))).toBe(true);
  });

  it.each(gated)('flags $name one build below its minimum on every distro', ({ name, minVersion }) => {
    for (const suffix of ['.el8', '.el9', 'focal', 'bookworm']) {
      expect(isBelowMinimum(name, `${previousVersion(minVersion!)}${suffix}`)).toBe(true);
    }
  });

  it.each(ungated)('accepts any version of $name, which declares no minimum', ({ name }) => {
    expect(isBelowMinimum(name, '0.0.1-1')).toBe(false);
  });

  it('ignores unknown packages and undetectable versions', () => {
    expect(isBelowMinimum('not-a-45drives-package', '0.0.1')).toBe(false);
    expect(isBelowMinimum(HOUSTON_PACKAGES[0].name, undefined)).toBe(false);
  });
});

describe('HOUSTON_PACKAGES', () => {
  it('declares unique package names', () => {
    const names = HOUSTON_PACKAGES.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('declares parseable minimums', () => {
    for (const p of HOUSTON_PACKAGES) {
      if (p.minVersion) expect(p.minVersion).toMatch(/^\d+(\.\d+)*(-\d+)?$/);
    }
  });
});
