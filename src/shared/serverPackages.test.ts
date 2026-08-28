import { describe, it, expect } from 'vitest';
import {
  compareVersions,
  isBelowMinimum,
  HOUSTON_PACKAGES,
  getHoustonPackage,
} from './serverPackages';

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

describe('isBelowMinimum', () => {
  it('flags packages older than the declared minimum', () => {
    expect(isBelowMinimum('cockpit-scheduler', '1.7.6-9')).toBe(true);
  });

  it('flags an older build of the minimum version', () => {
    expect(isBelowMinimum('cockpit-scheduler', '1.7.7-3.el8')).toBe(true);
    expect(isBelowMinimum('cockpit-scheduler', '1.7.7-3focal')).toBe(true);
  });

  it('accepts the minimum build on every distro', () => {
    for (const installed of ['1.7.7-4.el8', '1.7.7-4.el9', '1.7.7-4focal', '1.7.7-4bookworm']) {
      expect(isBelowMinimum('cockpit-scheduler', installed)).toBe(false);
    }
  });

  it('accepts the minimum and anything newer', () => {
    expect(isBelowMinimum('cockpit-scheduler', '1.7.7-4')).toBe(false);
    expect(isBelowMinimum('cockpit-scheduler', '1.8.0-1')).toBe(false);
  });

  it('accepts any version for packages without a minimum', () => {
    expect(getHoustonPackage('cockpit-zfs')?.minVersion).toBeUndefined();
    expect(isBelowMinimum('cockpit-zfs', '0.0.1')).toBe(false);
  });

  it('ignores unknown packages and undetectable versions', () => {
    expect(isBelowMinimum('not-a-45drives-package', '0.0.1')).toBe(false);
    expect(isBelowMinimum('cockpit-scheduler', undefined)).toBe(false);
  });
});

describe('HOUSTON_PACKAGES', () => {
  it('declares unique package names', () => {
    const names = HOUSTON_PACKAGES.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
