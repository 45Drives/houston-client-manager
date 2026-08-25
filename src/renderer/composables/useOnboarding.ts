import { computed } from 'vue';
import { useSettings } from './useSettings';

export type OnboardingFlag =
  | 'dashboardTourDone'
  | 'backupManagerSeen'
  | 'backupManagerTourDone'
  | 'createBackupTourDone'
  | 'backupListTourDone'
  | 'backupBrowserTourDone'
  | 'editTaskTourDone'
  | 'remoteBackupsTourDone'
  | 'restoreBrowserTourDone'
  | 'snapshotManagerTourDone'
  | 'serverManageTourDone'
  | 'smNetworkTabTourDone'
  | 'smStorageTabTourDone'
  | 'smUsersTabTourDone'
  | 'smSambaTabTourDone'
  | 'smSystemTabTourDone'
  | 'bulkSetupTourDone'
  | 'addExistingServerTourDone'
  | 'settingsTourDone'
  | 'topologyTourDone'
  | 'vpnTunnelsTourDone';

const DEFAULTS: Record<OnboardingFlag, boolean> = {
  dashboardTourDone: false,
  backupManagerSeen: false,
  backupManagerTourDone: false,
  createBackupTourDone: false,
  backupListTourDone: false,
  backupBrowserTourDone: false,
  editTaskTourDone: false,
  remoteBackupsTourDone: false,
  restoreBrowserTourDone: false,
  snapshotManagerTourDone: false,
  serverManageTourDone: false,
  smNetworkTabTourDone: false,
  smStorageTabTourDone: false,
  smUsersTabTourDone: false,
  smSambaTabTourDone: false,
  smSystemTabTourDone: false,
  bulkSetupTourDone: false,
  addExistingServerTourDone: false,
  settingsTourDone: false,
  topologyTourDone: false,
  vpnTunnelsTourDone: false,
};

export function useOnboarding() {
  const { settings, save } = useSettings();

  const onboarding = computed(() => ({
    ...DEFAULTS,
    ...settings.value?.onboarding,
  }));

  async function markDone(flag: OnboardingFlag) {
    await save({
      onboarding: { ...onboarding.value, [flag]: true },
    });
  }

  async function resetAll() {
    await save({ onboarding: { ...DEFAULTS } });
  }

  function isDone(flag: OnboardingFlag): boolean {
    return onboarding.value[flag];
  }

  return { onboarding, markDone, resetAll, isDone };
}
