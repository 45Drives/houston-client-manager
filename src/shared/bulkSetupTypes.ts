// Shared types for the Bulk Server Setup feature
// Used by both main process and renderer

export type BulkSetupMode = 'simple' | 'custom';

export type BulkSetupStatus =
  | 'queued'
  | 'bootstrapping'
  | 'probing'
  | 'configuring'
  | 'done'
  | 'failed';

export interface BulkServerEntry {
  /** Unique ID for this entry (client-generated) */
  id: string;
  /** IP or hostname of the target server */
  host: string;
  /** SSH username (default: root) */
  username: string;
  /** SSH password */
  password: string;
  /** Setup mode (simple uses defaults, custom allows full control) */
  mode: BulkSetupMode;
  /** Server name (hostname to assign) */
  serverName: string;
  /** SMB share name */
  shareName: string;
  /** SMB username */
  smbUser: string;
  /** SMB password */
  smbPass: string;
  /** SMB password confirmation (client-side only, not sent to server) */
  smbPassConfirm?: string;
  /** Use same password for root (default: true) */
  useSameRootPass?: boolean;
  /** Custom root password (when useSameRootPass is false) */
  rootPass?: string;
  /** Root password confirmation (client-side only) */
  rootPassConfirm?: string;
  /** Optional: full custom config (overrides simple fields when mode=custom) */
  customConfig?: BulkEasySetupConfig;
  /** Probed disk info (populated after probe phase) */
  diskInfo?: BulkDiskInfo;
  /** Probed server model info */
  serverModel?: string;
  /** Chassis size from server_info */
  chassisSize?: string;
  /** Whether to destroy existing ZFS pools and Samba shares before setup (default: false) */
  clearExistingData?: boolean;
  /** Active Backup: split disks into storage + backup pool with ZFS replication (default: false) */
  splitPools?: boolean;
}

export interface BulkDiskInfo {
  /** Available disks (not in use) */
  availableDisks: BulkDisk[];
  /** Existing ZFS pools */
  existingPools: string[];
}

export interface BulkDisk {
  name: string;       // e.g. "sda"
  size: string;       // e.g. "10T"
  type: 'HDD' | 'SSD' | 'NVMe' | 'unknown';
  model?: string;
  serial?: string;
  /** 45Drives vdev alias (e.g. "1-1") — used for /dev/disk/by-vdev/ paths in ZFS */
  alias?: string;
}

/** Simplified version of EasySetupConfig for the bulk setup JSON contract */
export interface BulkEasySetupConfig {
  srvrName?: string;
  folderName?: string;
  smbUser?: string;
  smbPass?: string;
  splitPools?: boolean;
  serverConfig?: {
    adminUser: string;
    adminPass: string;
    disableRootSSH: boolean;
    newRootPass?: string;
    timezone?: string;
    setTimezone?: boolean;
    useNTP?: boolean;
  };
  usersAndGroups?: {
    users: Array<{
      username: string;
      password: string;
      groups: string[];
      sshKey?: string;
    }>;
    groups: Array<{
      name: string;
      members?: string[];
    }>;
  };
  // ZFS and Samba configs are auto-generated from disk probe + simple fields
  // unless mode=custom with full overrides
}

export interface BulkSetupProgress {
  /** Server host this progress is for */
  host: string;
  /** Current status */
  status: BulkSetupStatus;
  /** Step number (1-based) */
  step: number;
  /** Total steps */
  totalSteps: number;
  /** Human-readable label for current step */
  label: string;
  /** Error message if status=failed */
  error?: string;
  /** Whether hostname was changed (set on final step) */
  hostnameChanged?: boolean;
}

/** A completed checklist step for UI display */
export interface BulkSetupStep {
  step: number;
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  error?: string;
}

export interface BulkSetupResult {
  host: string;
  success: boolean;
  reboot?: boolean;
  error?: string;
  /** How long setup took in ms */
  durationMs?: number;
  /** Summary of what was configured */
  summary?: string;
  /** Final hostname (after reboot) */
  finalHostname?: string;
}

export interface BulkSetupOptions {
  /** Run servers in parallel (default: false = sequential) */
  parallel?: boolean;
  /** Max parallel concurrency (default: 3) */
  maxConcurrency?: number;
  /** Skip bootstrap if deps already installed */
  skipBootstrapIfReady?: boolean;
}

/** Template for saving/loading bulk configs */
export interface BulkSetupTemplate {
  name: string;
  createdAt: string;
  servers: Omit<BulkServerEntry, 'id' | 'password' | 'diskInfo'>[];
}
