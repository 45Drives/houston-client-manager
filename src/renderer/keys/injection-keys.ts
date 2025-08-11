import type { InjectionKey, Reactive, Ref } from "vue";
import type { DivisionType, Server, DiscoveryState } from "../types";
import type { BackUpSetupConfig } from "@45drives/houston-common-lib";
import { RestoreBackupSetupData } from "../views/restoreBackupWizard/types";
import { ReviewBackupSetupData } from "../views/backupSetupWizard/types";

export const backUpSetupConfigKey: InjectionKey<BackUpSetupConfig> = Symbol('backup-setup-config');
export const restoreBackUpSetupDataKey: InjectionKey<RestoreBackupSetupData> = Symbol('restore-backup-setup-config');
export const divisionCodeInjectionKey: InjectionKey<Ref<DivisionType>> = Symbol('division-code');
export const currentServerInjectionKey: InjectionKey<Ref<Server | null>> = Symbol('server-info');
export const currentWizardInjectionKey: InjectionKey<Ref<'storage' | 'backup' | 'restore-backup' | null>> =
    Symbol('currentWizard');
export const thisOsInjectionKey: InjectionKey<Ref<string>> = Symbol('this-os');
export const discoveryStateInjectionKey: InjectionKey<DiscoveryState> =
    Symbol('discovery-state')
export const reviewBackUpSetupKey: InjectionKey<ReviewBackupSetupData> = Symbol('backup-setup-config');
