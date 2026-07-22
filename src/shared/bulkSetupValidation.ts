// Field validation rules matching the SSS (Super Simple Setup) wizard
// These run client-side before deploy, identical to what the server-side cockpit UI enforces

/** Valid hostname: alphanumeric + hyphens, no leading/trailing hyphen, max 63 chars */
const HOSTNAME_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

/** Password: min 8 chars, 1 uppercase, 1 digit, 1 special */
const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_+\-=[\]{};':"\\|,.<>/~`])[A-Za-z\d@$!%*?&#^()_+\-=[\]{};':"\\|,.<>/~`]{8,}$/;

/** Reserved usernames that cannot be used as SMB user */
const RESERVED_USERNAMES = [
  'root', 'admin', 'administrator', 'guest', 'nobody',
  'daemon', 'system', 'operator', 'user', 'test',
];

export interface FieldErrors {
  host?: string;
  serverName?: string;
  smbUser?: string;
  smbPass?: string;
  smbPassConfirm?: string;
  rootPass?: string;
  rootPassConfirm?: string;
  shareName?: string;
  password?: string;
  // Custom mode errors
  customAdminUser?: string;
  customAdminPass?: string;
  customSmbUser?: string;
  customSmbPass?: string;
  customPoolName?: string;
  customDisks?: string;
}

export function validateHostname(value: string): string | undefined {
  if (!value) return undefined; // Empty = keep current hostname (valid)
  if (value.length > 63) return 'Hostname must be 63 characters or fewer';
  if (!HOSTNAME_REGEX.test(value)) {
    return 'Only letters, numbers, and hyphens allowed. Cannot start or end with a hyphen.';
  }
  return undefined;
}

export function validateUsername(value: string): string | undefined {
  if (!value) return 'Username is required';
  if (/\s/.test(value)) return 'Username cannot contain spaces';
  if (RESERVED_USERNAMES.includes(value.toLowerCase())) {
    return `"${value}" is a reserved name and cannot be used`;
  }
  return undefined;
}

export function validatePassword(value: string): string | undefined {
  if (!value) return 'Password is required';
  if (value.length < 8) return 'Password must be at least 8 characters';
  if (!PASSWORD_REGEX.test(value)) {
    return 'Must include at least 1 uppercase letter, 1 number, and 1 special character';
  }
  return undefined;
}

export function validatePasswordMatch(pass: string, confirm: string): string | undefined {
  if (!confirm) return 'Please confirm the password';
  if (pass !== confirm) return 'Passwords do not match';
  return undefined;
}

export function validateShareName(value: string): string | undefined {
  if (!value) return 'Share name is required';
  if (/[/\\:*?"<>|]/.test(value)) return 'Share name contains invalid characters';
  return undefined;
}

export function validateHost(value: string): string | undefined {
  if (!value) return 'Host address is required';
  return undefined;
}

export function validateSshPassword(value: string): string | undefined {
  if (!value) return 'SSH password is required';
  return undefined;
}

/**
 * Validate all fields for a server entry. Returns errors object (empty = valid).
 */
export function validateServerEntry(entry: {
  host: string;
  password: string;
  serverName: string;
  smbUser: string;
  smbPass: string;
  smbPassConfirm?: string;
  shareName: string;
  rootPass?: string;
  rootPassConfirm?: string;
  useSameRootPass?: boolean;
  mode?: 'simple' | 'custom';
  customConfig?: any;
}): FieldErrors {
  const errors: FieldErrors = {};

  // Connection fields always required
  errors.host = validateHost(entry.host);
  errors.password = validateSshPassword(entry.password);

  if (entry.mode === 'custom') {
    // Custom mode validates from customConfig
    const cfg = entry.customConfig;
    if (cfg) {
      if (cfg.srvrName) {
        errors.serverName = validateHostname(cfg.srvrName);
      }
      if (cfg.serverConfig) {
        if (!cfg.serverConfig.adminUser) {
          errors.customAdminUser = 'Admin username is required';
        }
        if (cfg.serverConfig.adminPass) {
          errors.customAdminPass = validatePassword(cfg.serverConfig.adminPass);
        } else {
          errors.customAdminPass = 'Admin password is required';
        }
      }
      if (cfg.smbUser) {
        errors.customSmbUser = validateUsername(cfg.smbUser);
      } else {
        errors.customSmbUser = 'SMB username is required';
      }
      if (cfg.smbPass) {
        errors.customSmbPass = validatePassword(cfg.smbPass);
      } else {
        errors.customSmbPass = 'SMB password is required';
      }
      // ZFS: must have at least one pool with disks
      if (!cfg.zfsConfigs || cfg.zfsConfigs.length === 0) {
        errors.customDisks = 'At least one ZFS pool with disks is required';
      } else {
        const firstPool = cfg.zfsConfigs[0];
        if (!firstPool.pool?.vdevs?.length || !firstPool.pool.vdevs[0]?.disks?.length) {
          errors.customDisks = 'Select at least one disk for the storage pool';
        }
        if (!firstPool.pool?.name) {
          errors.customPoolName = 'Pool name is required';
        }
      }
    } else {
      errors.customAdminUser = 'Custom configuration is incomplete';
    }
  } else {
    // Simple mode validation (existing behavior)
    errors.serverName = validateHostname(entry.serverName);
    errors.smbUser = validateUsername(entry.smbUser);
    errors.smbPass = validatePassword(entry.smbPass);
    errors.shareName = validateShareName(entry.shareName);

    if (entry.smbPassConfirm !== undefined) {
      errors.smbPassConfirm = validatePasswordMatch(entry.smbPass, entry.smbPassConfirm);
    }

    if (!entry.useSameRootPass && entry.rootPass !== undefined) {
      errors.rootPass = validatePassword(entry.rootPass);
      if (entry.rootPassConfirm !== undefined) {
        errors.rootPassConfirm = validatePasswordMatch(entry.rootPass, entry.rootPassConfirm);
      }
    }
  }

  // Remove undefined entries
  for (const key of Object.keys(errors) as (keyof FieldErrors)[]) {
    if (!errors[key]) delete errors[key];
  }

  return errors;
}

/** Returns true if the entry has no field validation errors */
export function isEntryValid(errors: FieldErrors): boolean {
  return Object.keys(errors).length === 0;
}
