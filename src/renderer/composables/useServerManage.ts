/**
 * useServerManage — Composable for executing management actions on a remote server.
 *
 * Wraps the single `server:manage` IPC channel with typed helpers for ZFS, User, Group, and Samba operations.
 */

import { ref } from 'vue'
import { Notification, pushNotification } from '@45drives/houston-common-ui'

type ActionResult = { success: boolean; error?: string; data?: any }

export function useServerManage(getHost: () => string, getUsername: () => string) {
  const busy = ref(false)
  const lastError = ref<string | null>(null)

  async function getPassword(): Promise<string> {
    const cred = await window.electron.ipcRenderer.invoke('cred:get-for', getHost())
    return cred?.password || ''
  }

  async function run(action: string, params: Record<string, any> = {}): Promise<ActionResult> {
    busy.value = true
    lastError.value = null
    try {
      const password = await getPassword()
      if (!password) {
        lastError.value = 'No stored credentials found.'
        return { success: false, error: lastError.value }
      }
      const result: ActionResult = await window.electron.ipcRenderer.invoke('server:manage', {
        host: getHost(),
        username: getUsername(),
        password,
        action,
        params,
      })
      if (!result.success) lastError.value = result.error || 'Unknown error'
      return result
    } catch (e: any) {
      lastError.value = e?.message || 'Failed to execute action'
      return { success: false, error: lastError.value }
    } finally {
      busy.value = false
    }
  }

  // ── ZFS Pool ───────────────────────────────────────────────────────────

  async function getPoolStatus(pool: string) {
    return run('zfs:pool-status', { pool })
  }

  async function listDisks() {
    return run('zfs:list-disks')
  }

  async function createPool(name: string, vdevType: string, disks: string[], properties?: Record<string, string>) {
    return run('zfs:pool-create', { name, vdevType, disks, properties })
  }

  async function addVdev(pool: string, vdevType: string, disks: string[]) {
    return run('zfs:vdev-add', { pool, vdevType, disks })
  }

  async function attachDisk(pool: string, existingDisk: string, newDisk: string) {
    return run('zfs:disk-attach', { pool, existingDisk, newDisk })
  }

  async function detachDisk(pool: string, disk: string) {
    return run('zfs:disk-detach', { pool, disk })
  }

  async function offlineDisk(pool: string, disk: string) {
    return run('zfs:disk-offline', { pool, disk })
  }

  async function onlineDisk(pool: string, disk: string) {
    return run('zfs:disk-online', { pool, disk })
  }

  async function replaceDisk(pool: string, oldDisk: string, newDisk: string) {
    return run('zfs:disk-replace', { pool, oldDisk, newDisk })
  }

  // ── ZFS Dataset ────────────────────────────────────────────────────────

  async function createDataset(name: string, properties?: Record<string, string>) {
    return run('zfs:dataset-create', { name, properties })
  }

  async function destroyDataset(name: string, recursive?: boolean) {
    return run('zfs:dataset-destroy', { name, recursive })
  }

  async function getDatasetProps(name: string) {
    return run('zfs:dataset-get-props', { name })
  }

  async function setDatasetProp(name: string, property: string, value: string) {
    return run('zfs:dataset-set-prop', { name, property, value })
  }

  // ── ZFS Snapshots ──────────────────────────────────────────────────────

  async function listSnapshots(dataset?: string) {
    return run('zfs:snapshot-list', { dataset })
  }

  async function createSnapshot(dataset: string, snapName: string, recursive?: boolean) {
    return run('zfs:snapshot-create', { dataset, snapName, recursive })
  }

  async function destroySnapshot(name: string, recursive?: boolean) {
    return run('zfs:snapshot-destroy', { name, recursive })
  }

  async function rollbackSnapshot(name: string) {
    return run('zfs:snapshot-rollback', { name })
  }

  // ── Users ──────────────────────────────────────────────────────────────

  async function addUser(username: string, password?: string, groups?: string[], shell?: string) {
    return run('user:add', { username, password, groups, shell })
  }

  async function setUserPassword(username: string, password: string) {
    return run('user:set-password', { username, password })
  }

  async function setUserGroups(username: string, groups: string[]) {
    return run('user:set-groups', { username, groups })
  }

  async function deleteUser(username: string) {
    return run('user:delete', { username })
  }

  async function addSshKey(username: string, publicKey: string) {
    return run('user:add-ssh-key', { username, publicKey })
  }

  // ── Groups ─────────────────────────────────────────────────────────────

  async function addGroup(name: string) {
    return run('group:add', { name })
  }

  async function deleteGroup(name: string) {
    return run('group:delete', { name })
  }

  // ── Samba ──────────────────────────────────────────────────────────────

  async function setSambaUserPassword(username: string, password: string) {
    return run('samba:set-user-password', { username, password })
  }

  async function addSambaShare(name: string, sharePath: string, opts?: { comment?: string; guestOk?: boolean; readOnly?: boolean; browseable?: boolean }) {
    return run('samba:share-add', { name, path: sharePath, ...opts })
  }

  async function editSambaShare(name: string, settings: Record<string, string>) {
    return run('samba:share-edit', { name, settings })
  }

  async function removeSambaShare(name: string) {
    return run('samba:share-remove', { name })
  }

  async function editSambaGlobal(settings: Record<string, string>) {
    return run('samba:global-edit', { settings })
  }

  // ── Convenience: notify on result ──────────────────────────────────────

  async function runWithNotify(action: string, params: Record<string, any>, successMsg: string): Promise<ActionResult> {
    const result = await run(action, params)
    if (result.success) {
      pushNotification(new Notification('Success', successMsg, 'success', 3000))
    } else {
      pushNotification(new Notification('Error', result.error || 'Operation failed', 'error', 8000))
    }
    return result
  }

  return {
    busy,
    lastError,
    run,
    runWithNotify,
    // ZFS Pool
    getPoolStatus,
    listDisks,
    createPool,
    addVdev,
    attachDisk,
    detachDisk,
    offlineDisk,
    onlineDisk,
    replaceDisk,
    // ZFS Dataset
    createDataset,
    destroyDataset,
    getDatasetProps,
    setDatasetProp,
    // ZFS Snapshots
    listSnapshots,
    createSnapshot,
    destroySnapshot,
    rollbackSnapshot,
    // Users
    addUser,
    setUserPassword,
    setUserGroups,
    deleteUser,
    addSshKey,
    // Groups
    addGroup,
    deleteGroup,
    // Samba
    setSambaUserPassword,
    addSambaShare,
    editSambaShare,
    removeSambaShare,
    editSambaGlobal,
  }
}
