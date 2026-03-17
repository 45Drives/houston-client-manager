import { describe, it, expect } from 'vitest';

// ── Replicate getDiskIDName from composables/utility.ts
// (The function was changed from using Vue ref() to plain variables)

interface DiskData {
  name: string;
  vdev_path: string;
  phy_path: string;
  sd_path: string;
}

function getDiskIDName(
  disks: DiskData[],
  diskIdentifier: string,
  selectedDiskName: string
) {
  const phyPathPrefix = '/dev/disk/by-path/';
  const sdPathPrefix = '/dev/';
  const foundDisk = disks.find((disk) => disk.name === selectedDiskName);
  let diskName = '';
  let diskPath = '';

  if (!foundDisk) {
    return { diskName, diskPath };
  }

  switch (diskIdentifier) {
    case 'vdev_path':
      diskPath = foundDisk.vdev_path;
      diskName = selectedDiskName;
      break;
    case 'phy_path':
      diskPath = foundDisk.phy_path;
      diskName = diskPath.replace(phyPathPrefix, '');
      break;
    case 'sd_path':
      diskPath = foundDisk.sd_path;
      diskName = diskPath.replace(sdPathPrefix, '');
      break;
    default:
      break;
  }

  return { diskName, diskPath };
}

const MOCK_DISKS: DiskData[] = [
  {
    name: 'sda',
    vdev_path: '/dev/disk/by-vdev/1-1',
    phy_path: '/dev/disk/by-path/pci-0000:00:1f.2-ata-1',
    sd_path: '/dev/sda',
  },
  {
    name: 'sdb',
    vdev_path: '/dev/disk/by-vdev/1-2',
    phy_path: '/dev/disk/by-path/pci-0000:00:1f.2-ata-2',
    sd_path: '/dev/sdb',
  },
];

describe('getDiskIDName()', () => {
  it('returns vdev_path with original disk name', () => {
    const result = getDiskIDName(MOCK_DISKS, 'vdev_path', 'sda');
    expect(result.diskPath).toBe('/dev/disk/by-vdev/1-1');
    expect(result.diskName).toBe('sda');
  });

  it('returns phy_path with prefix stripped', () => {
    const result = getDiskIDName(MOCK_DISKS, 'phy_path', 'sda');
    expect(result.diskPath).toBe('/dev/disk/by-path/pci-0000:00:1f.2-ata-1');
    expect(result.diskName).toBe('pci-0000:00:1f.2-ata-1');
  });

  it('returns sd_path with /dev/ prefix stripped', () => {
    const result = getDiskIDName(MOCK_DISKS, 'sd_path', 'sdb');
    expect(result.diskPath).toBe('/dev/sdb');
    expect(result.diskName).toBe('sdb');
  });

  it('returns empty strings when disk not found', () => {
    const result = getDiskIDName(MOCK_DISKS, 'vdev_path', 'nonexistent');
    expect(result.diskName).toBe('');
    expect(result.diskPath).toBe('');
  });

  it('returns empty strings for unknown identifier', () => {
    const result = getDiskIDName(MOCK_DISKS, 'unknown_identifier', 'sda');
    expect(result.diskName).toBe('');
    expect(result.diskPath).toBe('');
  });

  it('returns empty strings when disks array is empty', () => {
    const result = getDiskIDName([], 'vdev_path', 'sda');
    expect(result.diskName).toBe('');
    expect(result.diskPath).toBe('');
  });
});
