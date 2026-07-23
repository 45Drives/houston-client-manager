// Composable for managing bulk server setup state in the renderer
import { ref, computed, onBeforeUnmount } from 'vue';
import { v4 as uuidv4 } from 'uuid';
import type {
  BulkServerEntry,
  BulkSetupProgress,
  BulkSetupResult,
  BulkSetupOptions,
  BulkSetupTemplate,
  BulkDiskInfo,
  BulkSetupStep,
} from '../../shared/bulkSetupTypes';
import { validateServerEntry, isEntryValid, type FieldErrors } from '../../shared/bulkSetupValidation';
import { useServers } from './useServers';

export type BulkServerState = BulkServerEntry & {
  progress?: BulkSetupProgress;
  result?: BulkSetupResult;
  validated?: boolean;
  validationError?: string;
  fieldErrors?: FieldErrors;
  /** Running checklist of steps completed/in-progress */
  steps: BulkSetupStep[];
};

// Singleton state (shared across components)
const servers = ref<BulkServerState[]>([]);
const isRunning = ref(false);
const isValidating = ref(false);

export function useBulkSetup() {
  // Get refresh function from useServers at setup time (while in component context)
  let refreshServersList: (() => Promise<any>) | null = null;
  try {
    const { refresh } = useServers();
    refreshServersList = refresh;
  } catch { /* ok — may not be in component context */ }

  // ── Listeners for IPC events ──────────────────────────────────────────

  function onProgress(_event: any, progress: BulkSetupProgress) {
    const srv = servers.value.find(s => s.host === progress.host);
    if (!srv) return;

    srv.progress = progress;

    // Build running checklist from progress events
    if (progress.step > 0 && progress.label) {
      // Mark all previous steps as done
      for (const s of srv.steps) {
        if (s.step < progress.step && s.status === 'running') {
          s.status = 'done';
        }
      }

      // Update or add the current step
      const existing = srv.steps.find(s => s.step === progress.step);
      if (existing) {
        existing.label = progress.label;
        existing.status = progress.status === 'failed' ? 'failed' : progress.status === 'done' ? 'done' : 'running';
        if (progress.error) existing.error = progress.error;
      } else {
        srv.steps.push({
          step: progress.step,
          label: progress.label,
          status: progress.status === 'failed' ? 'failed' : progress.status === 'done' ? 'done' : 'running',
          error: progress.error,
        });
      }
    }

    // Handle final states
    if (progress.status === 'done') {
      // Mark all steps as done
      for (const s of srv.steps) {
        if (s.status === 'running') s.status = 'done';
      }
      srv.result = { host: progress.host, success: true };
    } else if (progress.status === 'failed') {
      // Mark current step as failed
      const current = srv.steps.find(s => s.step === progress.step);
      if (current) {
        current.status = 'failed';
        current.error = progress.error;
      }
      srv.result = { host: progress.host, success: false, error: progress.error };
    }
  }

  function onResult(_event: any, result: BulkSetupResult) {
    const srv = servers.value.find(s => s.host === result.host);
    if (srv) {
      srv.result = result;
      // Update displayed hostname if server reports final hostname after reboot
      if (result.finalHostname && result.finalHostname !== srv.serverName) {
        srv.serverName = result.finalHostname;
      }
      // Auto-save successfully setup servers to the saved servers list
      if (result.success) {
        saveServerToVault(srv);
      }
    }
  }

  function onComplete(_event: any, summary: any) {
    isRunning.value = false;
    // Process any results from the summary as a fallback
    // (handles cases where individual result events were missed)
    if (summary?.results && Array.isArray(summary.results)) {
      for (const result of summary.results) {
        if (!result.success) continue;
        const srv = servers.value.find(s => s.host === result.host);
        if (srv && !srv.result?.success) {
          srv.result = result;
          if (result.finalHostname && result.finalHostname !== srv.serverName) {
            srv.serverName = result.finalHostname;
          }
          saveServerToVault(srv);
        }
      }
    }
  }

  /**
   * Save a successfully setup server to the credential vault (saved servers list).
   * Uses servers:add which deduplicates by host automatically.
   */
  async function saveServerToVault(srv: BulkServerState) {
    try {
      const smbUser = srv.mode === 'custom' && srv.customConfig?.smbUser
        ? srv.customConfig.smbUser
        : srv.smbUser;
      const smbPass = srv.mode === 'custom' && srv.customConfig?.smbPass
        ? srv.customConfig.smbPass
        : srv.smbPass;
      const shareName = srv.mode === 'custom' && srv.customConfig?.folderName
        ? srv.customConfig.folderName
        : srv.shareName;
      const serverName = srv.mode === 'custom' && srv.customConfig?.srvrName
        ? srv.customConfig.srvrName
        : srv.serverName;

      await window.electron?.ipcRenderer.invoke('servers:add', {
        host: srv.host,
        shareName: shareName || 'share',
        username: srv.username,
        password: srv.password,
        smbUser: smbUser || undefined,
        smbPass: smbPass || undefined,
        name: serverName || undefined,
        setupComplete: true,
      });

      // Refresh the saved servers list so the UI updates immediately
      refreshServersList?.().catch(() => {});
    } catch (e) {
      console.error('[BulkSetup] Failed to save server to vault:', srv.host, e);
    }
  }

  function startListening() {
    window.electron?.ipcRenderer.on('bulk-setup:progress', onProgress);
    window.electron?.ipcRenderer.on('bulk-setup:result', onResult);
    window.electron?.ipcRenderer.on('bulk-setup:complete', onComplete);
  }

  function stopListening() {
    window.electron?.ipcRenderer.removeListener('bulk-setup:progress', onProgress);
    window.electron?.ipcRenderer.removeListener('bulk-setup:result', onResult);
    window.electron?.ipcRenderer.removeListener('bulk-setup:complete', onComplete);
  }

  onBeforeUnmount(stopListening);

  // ── Server management ─────────────────────────────────────────────────

  function addServer(partial?: Partial<BulkServerEntry>) {
    servers.value.push({
      id: uuidv4(),
      host: '',
      username: 'root',
      password: '',
      mode: 'simple',
      serverName: '',
      shareName: 'share',
      smbUser: '',
      smbPass: '',
      smbPassConfirm: '',
      useSameRootPass: true,
      rootPass: '',
      rootPassConfirm: '',
      clearExistingData: false,
      splitPools: false,
      steps: [],
      ...partial,
    });
  }

  function removeServer(index: number) {
    servers.value.splice(index, 1);
  }

  function updateServer(index: number, updates: Partial<BulkServerEntry>) {
    if (servers.value[index]) {
      Object.assign(servers.value[index], updates);
    }
  }

  function clearAll() {
    servers.value = [];
  }

  // ── Global defaults ────────────────────────────────────────────────────

  function applyGlobalDefaults(defaults: { username?: string; password?: string; authMethod?: 'password' | 'key'; sshKeyPath?: string; sshPassphrase?: string; smbUser?: string; smbPass?: string }) {
    for (const srv of servers.value) {
      if (defaults.username && !srv.username) srv.username = defaults.username;
      if (defaults.password && !srv.password) srv.password = defaults.password;
      if (defaults.authMethod && !srv.authMethod) srv.authMethod = defaults.authMethod;
      if (defaults.sshKeyPath && !srv.sshKeyPath) srv.sshKeyPath = defaults.sshKeyPath;
      if (defaults.sshPassphrase && !srv.sshPassphrase) srv.sshPassphrase = defaults.sshPassphrase;
      if (defaults.smbUser && !srv.smbUser) srv.smbUser = defaults.smbUser;
      if (defaults.smbPass && !srv.smbPass) srv.smbPass = defaults.smbPass;
    }
  }

  // ── Field Validation ────────────────────────────────────────────────────

  function validateFields(): boolean {
    let allValid = true;
    for (const srv of servers.value) {
      const errors = validateServerEntry({
        host: srv.host,
        password: srv.password,
        serverName: srv.serverName,
        smbUser: srv.smbUser,
        smbPass: srv.smbPass,
        smbPassConfirm: srv.smbPassConfirm,
        shareName: srv.shareName,
        useSameRootPass: srv.useSameRootPass,
        rootPass: srv.rootPass,
        rootPassConfirm: srv.rootPassConfirm,
        mode: srv.mode,
        customConfig: srv.customConfig,
        authMethod: srv.authMethod,
        sshKeyPath: srv.sshKeyPath,
      });
      srv.fieldErrors = errors;
      if (!isEntryValid(errors)) allValid = false;
    }
    return allValid;
  }

  // ── Validation ─────────────────────────────────────────────────────────

  async function validateAll(): Promise<boolean> {
    isValidating.value = true;
    try {
      const toValidate = servers.value.map(s => ({
        host: s.host,
        username: s.username,
        password: s.password,
        authMethod: s.authMethod,
        sshKeyPath: s.sshKeyPath,
        sshPassphrase: s.sshPassphrase,
      }));

      const results: Array<{ host: string; reachable: boolean; isAdmin?: boolean; error?: string }> =
        await window.electron.ipcRenderer.invoke('bulk-setup:validate', JSON.parse(JSON.stringify(toValidate)));

      let allValid = true;
      for (const r of results) {
        const srv = servers.value.find(s => s.host === r.host);
        if (srv) {
          if (!r.reachable || r.error) {
            srv.validated = false;
            srv.validationError = r.error || 'Not reachable';
            allValid = false;
          } else if (!r.isAdmin) {
            srv.validated = false;
            srv.validationError = 'User does not have root/admin privileges';
            allValid = false;
          } else {
            srv.validated = true;
            srv.validationError = undefined;
          }
        }
      }
      return allValid;
    } finally {
      isValidating.value = false;
    }
  }

  // ── Probe disks ────────────────────────────────────────────────────────

  async function probeAll(): Promise<void> {
    const toProbe = servers.value.map(s => ({
      host: s.host,
      username: s.username,
      password: s.password,
      authMethod: s.authMethod,
      sshKeyPath: s.sshKeyPath,
      sshPassphrase: s.sshPassphrase,
    }));

    const results: Array<{ host: string; diskInfo?: BulkDiskInfo; serverModel?: string; chassisSize?: string; existingGroups?: string[]; existingUsers?: string[]; error?: string }> =
      await window.electron.ipcRenderer.invoke('bulk-setup:probe', JSON.parse(JSON.stringify(toProbe)));

    for (const r of results) {
      const srv = servers.value.find(s => s.host === r.host);
      if (srv) {
        srv.diskInfo = r.diskInfo;
        srv.serverModel = r.serverModel;
        srv.chassisSize = r.chassisSize;
        srv.existingGroups = r.existingGroups;
        srv.existingUsers = r.existingUsers;
      }
    }
  }

  /**
   * Validate SSH + probe disks for a single server.
   * Returns true if connection succeeded and disks were probed.
   */
  async function connectAndProbe(serverId: string): Promise<boolean> {
    const srv = servers.value.find(s => s.id === serverId);
    if (!srv || !srv.host) return false;
    if (srv.authMethod !== 'key' && !srv.password) return false;

    srv.validated = undefined;
    srv.validationError = undefined;

    // Validate SSH
    const validateResults: Array<{ host: string; reachable: boolean; isAdmin?: boolean; error?: string }> =
      await window.electron.ipcRenderer.invoke('bulk-setup:validate', JSON.parse(JSON.stringify([{
        host: srv.host,
        username: srv.username,
        password: srv.password,
        authMethod: srv.authMethod,
        sshKeyPath: srv.sshKeyPath,
        sshPassphrase: srv.sshPassphrase,
      }])));

    const vr = validateResults[0];
    if (!vr || !vr.reachable || vr.error) {
      srv.validated = false;
      srv.validationError = vr?.error || 'Not reachable';
      return false;
    }
    if (!vr.isAdmin) {
      srv.validated = false;
      srv.validationError = 'User does not have root/admin privileges';
      return false;
    }
    srv.validated = true;
    srv.validationError = undefined;

    // Probe disks, existing groups and users
    const probeResults: Array<{ host: string; diskInfo?: BulkDiskInfo; serverModel?: string; chassisSize?: string; existingGroups?: string[]; existingUsers?: string[]; error?: string }> =
      await window.electron.ipcRenderer.invoke('bulk-setup:probe', JSON.parse(JSON.stringify([{
        host: srv.host,
        username: srv.username,
        password: srv.password,
        authMethod: srv.authMethod,
        sshKeyPath: srv.sshKeyPath,
        sshPassphrase: srv.sshPassphrase,
      }])));

    const pr = probeResults[0];
    if (pr) {
      srv.diskInfo = pr.diskInfo;
      srv.serverModel = pr.serverModel;
      srv.chassisSize = pr.chassisSize;
      srv.existingGroups = pr.existingGroups;
      srv.existingUsers = pr.existingUsers;
    }

    // Auto-disable splitPools if not enough disks
    if (srv.splitPools && srv.diskInfo && srv.diskInfo.availableDisks.length <= 4) {
      srv.splitPools = false;
    }

    return true;
  }

  // ── Deploy ─────────────────────────────────────────────────────────────

  /**
   * Run preflight checks (field validation, SSH validation, disk probe)
   * without starting the actual deploy. Returns true if all checks pass.
   */
  async function preflightCheck(): Promise<boolean> {
    // Validate all form fields first (hostname, password strength, etc.)
    const fieldsValid = validateFields();
    if (!fieldsValid) {
      return false;
    }

    // Auto-validate SSH connectivity if not already validated
    const needsValidation = servers.value.some(s => !s.validated);
    if (needsValidation) {
      await validateAll();
    }

    // Check for validation failures
    const validationFailed = servers.value.filter(s => s.validationError);
    if (validationFailed.length > 0) {
      return false;
    }

    // Auto-probe any servers missing disk info
    const needsProbe = servers.value.some(s => !s.diskInfo);
    if (needsProbe) {
      await probeAll();
    }

    // All servers must have disk info
    const missingDisks = servers.value.filter(s => !s.diskInfo || !s.diskInfo.availableDisks?.length);
    if (missingDisks.length > 0) {
      return false;
    }

    // Auto-disable splitPools if server doesn't have enough disks
    for (const srv of servers.value) {
      if (srv.splitPools && srv.diskInfo && srv.diskInfo.availableDisks.length <= 4) {
        srv.splitPools = false;
      }
    }

    return true;
  }

  async function deploy(options?: BulkSetupOptions) {
    // Validate all form fields first (hostname, password strength, etc.)
    const fieldsValid = validateFields();
    if (!fieldsValid) {
      const invalid = servers.value.filter(s => s.fieldErrors && Object.keys(s.fieldErrors).length > 0);
      const names = invalid.map(s => s.serverName || s.host || 'unnamed').join(', ');
      throw new Error(`Fix field errors before deploying: ${names}`);
    }

    // Auto-validate SSH connectivity if not already validated
    const needsValidation = servers.value.some(s => !s.validated);
    if (needsValidation) {
      await validateAll();
    }

    // Guard: check for validation failures
    const validationFailed = servers.value.filter(s => s.validationError);
    if (validationFailed.length > 0) {
      const names = validationFailed.map(s => `${s.serverName || s.host}: ${s.validationError}`).join('; ');
      throw new Error(`Cannot deploy — validation failed: ${names}`);
    }

    // Auto-probe any servers missing disk info
    const needsProbe = servers.value.some(s => !s.diskInfo);
    if (needsProbe) {
      await probeAll();
    }

    // Guard: all servers must have disk info before proceeding
    const missingDisks = servers.value.filter(s => !s.diskInfo || !s.diskInfo.availableDisks?.length);
    if (missingDisks.length > 0) {
      const names = missingDisks.map(s => s.serverName || s.host).join(', ');
      throw new Error(`Cannot deploy: no disks found on ${names}. Run Probe Disks first.`);
    }

    isRunning.value = true;
    startListening();

    // Reset progress/results
    for (const srv of servers.value) {
      srv.progress = { host: srv.host, status: 'queued', step: 0, totalSteps: 10, label: 'Queued...' };
      srv.result = undefined;
      srv.steps = [];
    }

    try {
      const entries: BulkServerEntry[] = servers.value.map(s => ({
        id: s.id,
        host: s.host,
        username: s.username,
        password: s.password,
        authMethod: s.authMethod,
        sshKeyPath: s.sshKeyPath,
        sshPassphrase: s.sshPassphrase,
        mode: s.mode,
        serverName: s.serverName,
        shareName: s.shareName,
        smbUser: s.smbUser,
        smbPass: s.smbPass,
        useSameRootPass: s.useSameRootPass,
        rootPass: s.rootPass,
        customConfig: s.customConfig ? JSON.parse(JSON.stringify(s.customConfig)) : undefined,
        diskInfo: s.diskInfo ? JSON.parse(JSON.stringify(s.diskInfo)) : undefined,
        serverModel: s.serverModel,
        chassisSize: s.chassisSize,
        clearExistingData: s.clearExistingData,
        splitPools: s.splitPools,
      }));

      const summary = await window.electron.ipcRenderer.invoke('bulk-setup:run', JSON.parse(JSON.stringify(entries)), options ? JSON.parse(JSON.stringify(options)) : undefined);
      return summary;
    } catch (err) {
      isRunning.value = false;
      throw err;
    }
  }

  async function cancel() {
    await window.electron.ipcRenderer.invoke('bulk-setup:cancel');
    isRunning.value = false;
  }

  async function retryServer(host: string, options?: BulkSetupOptions) {
    const srv = servers.value.find(s => s.host === host);
    if (!srv) return;

    srv.progress = { host, status: 'queued', step: 0, totalSteps: 10, label: 'Retrying...' };
    srv.result = undefined;
    srv.steps = [];
    isRunning.value = true;
    startListening();

    try {
      const entries: BulkServerEntry[] = [{
        id: srv.id,
        host: srv.host,
        username: srv.username,
        password: srv.password,
        authMethod: srv.authMethod,
        sshKeyPath: srv.sshKeyPath,
        sshPassphrase: srv.sshPassphrase,
        mode: srv.mode,
        serverName: srv.serverName,
        shareName: srv.shareName,
        smbUser: srv.smbUser,
        smbPass: srv.smbPass,
        useSameRootPass: srv.useSameRootPass,
        rootPass: srv.rootPass,
        customConfig: srv.customConfig ? JSON.parse(JSON.stringify(srv.customConfig)) : undefined,
        diskInfo: srv.diskInfo ? JSON.parse(JSON.stringify(srv.diskInfo)) : undefined,
        serverModel: srv.serverModel,
        chassisSize: srv.chassisSize,
        clearExistingData: srv.clearExistingData,
        splitPools: srv.splitPools,
      }];

      await window.electron.ipcRenderer.invoke('bulk-setup:run', JSON.parse(JSON.stringify(entries)), options ? JSON.parse(JSON.stringify(options)) : undefined);
    } finally {
      isRunning.value = false;
    }
  }

  // ── Templates ──────────────────────────────────────────────────────────

  function exportTemplate(): BulkSetupTemplate {
    return {
      name: `Bulk Setup ${new Date().toISOString().slice(0, 10)}`,
      createdAt: new Date().toISOString(),
      servers: servers.value.map(({ id, password, diskInfo, progress, result, validated, validationError, ...rest }) => rest),
    };
  }

  function importTemplate(template: BulkSetupTemplate) {
    servers.value = template.servers.map(s => ({
      smbPassConfirm: '',
      useSameRootPass: true,
      rootPass: '',
      rootPassConfirm: '',
      clearExistingData: false,
      splitPools: false,
      steps: [],
      ...s,
      id: uuidv4(),
      password: '',
    }));
  }

  // ── Computed ───────────────────────────────────────────────────────────

  const totalServers = computed(() => servers.value.length);
  const completedServers = computed(() => servers.value.filter(s => s.result?.success).length);
  const failedServers = computed(() => servers.value.filter(s => s.result && !s.result.success).length);
  const isComplete = computed(() => !isRunning.value && servers.value.length > 0 && servers.value.every(s => s.result));

  return {
    servers,
    isRunning,
    isValidating,
    isComplete,
    totalServers,
    completedServers,
    failedServers,
    addServer,
    removeServer,
    updateServer,
    clearAll,
    applyGlobalDefaults,
    validateFields,
    validateAll,
    probeAll,
    connectAndProbe,
    preflightCheck,
    deploy,
    cancel,
    retryServer,
    exportTemplate,
    importTemplate,
    startListening,
    stopListening,
  };
}
