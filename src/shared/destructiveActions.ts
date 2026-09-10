/**
 * Actions that remove or overwrite state that already exists on a server, or that
 * can lock users out of it. These require the admin password to be typed again at
 * the moment of use rather than being taken from the credential vault, so an app
 * left open on an unlocked desktop cannot destroy data.
 *
 * Shared by the renderer (to prompt) and the main process (to enforce).
 */
export const DESTRUCTIVE_ACTIONS = new Set<string>([
  // ZFS — pool topology. Creating a pool wipes its member disks; vdev and disk
  // changes cannot be undone once the pool accepts them.
  'zfs:pool-create',
  'zfs:vdev-add',
  'zfs:disk-attach',
  'zfs:disk-detach',
  'zfs:disk-offline',
  'zfs:disk-replace',

  // ZFS — data
  'zfs:dataset-destroy',
  'zfs:snapshot-destroy',
  'zfs:snapshot-rollback',

  // Accounts
  'user:delete',
  'user:set-password',
  'group:delete',

  // Samba. Editing a share silently repoints backups; a bad global can lock
  // every client out at once.
  'samba:share-edit',
  'samba:share-remove',
  'samba:global-edit',
  'samba:set-user-password',
]);

export function isDestructiveAction(action: string): boolean {
  return DESTRUCTIVE_ACTIONS.has(action);
}

/** Human wording for the confirmation prompt. */
export const DESTRUCTIVE_ACTION_LABELS: Record<string, string> = {
  'zfs:pool-create': 'Create a storage pool (erases the selected disks)',
  'zfs:vdev-add': 'Add a vdev to a pool',
  'zfs:disk-attach': 'Attach a disk to a pool',
  'zfs:disk-detach': 'Detach a disk from a pool',
  'zfs:disk-offline': 'Take a disk offline',
  'zfs:disk-replace': 'Replace a disk in a pool',
  'zfs:dataset-destroy': 'Destroy a dataset and everything in it',
  'zfs:snapshot-destroy': 'Destroy a snapshot',
  'zfs:snapshot-rollback': 'Roll a dataset back to a snapshot',
  'user:delete': 'Delete a user account',
  'user:set-password': 'Change a user password',
  'group:delete': 'Delete a group',
  'samba:share-edit': 'Change an existing Samba share',
  'samba:share-remove': 'Remove a Samba share',
  'samba:global-edit': 'Change global Samba settings',
  'samba:set-user-password': 'Change a Samba user password',
  'server:apply-changes': 'Change server configuration',
};

export function describeDestructiveAction(action: string): string {
  return DESTRUCTIVE_ACTION_LABELS[action] || action;
}
