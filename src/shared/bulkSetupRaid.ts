// RAID level selection and capacity estimation
// Shared between renderer (preview) and main process (config building)

import type { BulkDisk } from './bulkSetupTypes';

export type RaidLevel = 'disk' | 'mirror' | 'raidz1' | 'raidz2' | 'raidz3';

export interface RaidPreview {
  raidLevel: RaidLevel;
  raidLabel: string;
  diskCount: number;
  redundancy: number;
  usableDisks: number;
  /** Estimated usable capacity string (e.g. "80 TB") */
  usableCapacity: string;
  /** Raw total capacity string */
  rawCapacity: string;
}

export interface SplitPoolPreview {
  storage: RaidPreview;
  backup: RaidPreview;
}

/** Pick RAID level based on disk count (matches SSS wizard logic) */
export function pickRaidLevel(diskCount: number): RaidLevel {
  if (diskCount >= 6) return 'raidz2';
  if (diskCount >= 3) return 'raidz1';
  if (diskCount === 2) return 'mirror';
  return 'disk';
}

function raidLabel(level: RaidLevel): string {
  switch (level) {
    case 'disk': return 'Single Disk (no redundancy)';
    case 'mirror': return 'Mirror';
    case 'raidz1': return 'RAIDZ1 (1 disk redundancy)';
    case 'raidz2': return 'RAIDZ2 (2 disk redundancy)';
    case 'raidz3': return 'RAIDZ3 (3 disk redundancy)';
  }
}

function raidRedundancy(level: RaidLevel): number {
  switch (level) {
    case 'disk': return 0;
    case 'mirror': return 1;
    case 'raidz1': return 1;
    case 'raidz2': return 2;
    case 'raidz3': return 3;
  }
}

/** Parse a size string like "10T", "1.8T", "500G" into bytes */
function parseSizeToBytes(size: string): number {
  const match = size.match(/^([\d.]+)\s*([TGMK]?)i?B?$/i);
  if (!match) return 0;
  const val = parseFloat(match[1]!);
  const unit = (match[2] || '').toUpperCase();
  switch (unit) {
    case 'T': return val * 1e12;
    case 'G': return val * 1e9;
    case 'M': return val * 1e6;
    case 'K': return val * 1e3;
    default: return val;
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${(bytes / 1e6).toFixed(0)} MB`;
}

function previewForDisks(disks: BulkDisk[]): RaidPreview {
  const count = disks.length;
  const level = pickRaidLevel(count);
  const redundancy = raidRedundancy(level);
  const usableCount = Math.max(count - redundancy, level === 'mirror' ? 1 : 0);

  // Use smallest disk size for capacity estimate (ZFS uses smallest in vdev)
  const sizes = disks.map(d => parseSizeToBytes(d.size)).filter(s => s > 0);
  const smallestDisk = sizes.length > 0 ? Math.min(...sizes) : 0;
  const rawTotal = sizes.reduce((a, b) => a + b, 0);
  const usableBytes = smallestDisk * usableCount;

  return {
    raidLevel: level,
    raidLabel: raidLabel(level),
    diskCount: count,
    redundancy,
    usableDisks: usableCount,
    usableCapacity: formatBytes(usableBytes),
    rawCapacity: formatBytes(rawTotal),
  };
}

/** Get RAID preview for a single pool using all disks */
export function getSinglePoolPreview(disks: BulkDisk[]): RaidPreview {
  return previewForDisks(disks);
}

/** Get RAID preview for split pools (active backup) — splits disks evenly */
export function getSplitPoolPreview(disks: BulkDisk[]): SplitPoolPreview {
  const half = Math.ceil(disks.length / 2);
  const storageDisks = disks.slice(0, half);
  const backupDisks = disks.slice(half);

  return {
    storage: previewForDisks(storageDisks),
    backup: previewForDisks(backupDisks),
  };
}
