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
  /** Existing system groups (gid >= 1000) discovered during probe */
  existingGroups?: string[];
  /** Existing system users (uid >= 1000) discovered during probe */
  existingUsers?: string[];
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

/** Full EasySetupConfig for the bulk setup JSON contract (custom mode) */
export interface BulkEasySetupConfig {
  srvrName?: string;
  folderName?: string;
  smbUser?: string;
  smbPass?: string;
  splitPools?: boolean;
  serverConfig?: BulkServerConfig;
  usersAndGroups?: BulkUsersAndGroupsConfig;
  zfsConfigs?: BulkZFSConfig[];
  sambaConfig?: BulkSambaConfig;
  /** If true, skip destruction of existing ZFS pools and Samba shares */
  skipClearExisting?: boolean;
}

export interface BulkServerConfig {
  adminUser: string;
  adminPass: string;
  disableRootSSH: boolean;
  newRootPass?: string;
  timezone?: string;
  setTimezone?: boolean;
  useNTP?: boolean;
}

export interface BulkUsersAndGroupsConfig {
  users: BulkUserSpec[];
  groups: BulkGroupSpec[];
}

export interface BulkUserSpec {
  username: string;
  password: string;
  groups: string[];
  sshKey?: string;
}

export interface BulkGroupSpec {
  name: string;
  members?: string[];
}

// ── ZFS Types (mirrors houston-common-lib ZFS types for serialization) ──

export type BulkVDevType = 'mirror' | 'raidz1' | 'raidz2' | 'raidz3' | 'disk' | 'stripe';

export interface BulkVDevDisk {
  path: string;
  name?: string;
  alias?: string;
}

export interface BulkVDev {
  type: BulkVDevType | string;
  disks: BulkVDevDisk[];
}

export interface BulkPoolOptions {
  autoexpand?: string;
  autoreplace?: string;
  autotrim?: string;
  compression?: string;
  recordsize?: number;
  dedup?: string;
  forceCreate?: boolean;
}

export interface BulkDatasetOptions {
  encryption?: string;
  atime?: string;
  casesensitivity?: string;
  compression?: string;
  dedup?: string;
  recordsize?: string;
}

export interface BulkZFSConfig {
  pool: {
    name: string;
    vdevs: BulkVDev[];
  };
  poolOptions: BulkPoolOptions;
  dataset: {
    name: string;
  };
  datasetOptions: BulkDatasetOptions;
  additionalDatasets?: Array<{
    dataset: { name: string };
    datasetOptions: BulkDatasetOptions;
  }>;
}

// ── Samba Types (mirrors houston-common-lib Samba types for serialization) ──

export interface BulkSambaGlobalConfig {
  logLevel: number;
  workgroup: string;
  serverString: string;
}

export interface BulkSambaShareConfig {
  name: string;
  description: string;
  path: string;
  guestOk: boolean;
  readOnly: boolean;
  browseable: boolean;
  inheritPermissions: boolean;
}

export interface BulkSambaConfig {
  global: BulkSambaGlobalConfig;
  shares: BulkSambaShareConfig[];
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
