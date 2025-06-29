import type { InjectionKey, Reactive, Ref } from "vue";
import type { DivisionType, Server } from "../types";
import type { BackUpSetupConfig } from "@45drives/houston-common-lib";
import { RestoreBackupSetupData } from "../views/restoreBackupWizard/types";

export const backUpSetupConfigKey: InjectionKey<BackUpSetupConfig> = Symbol('backup-setup-config');
export const restoreBackUpSetupDataKey: InjectionKey<RestoreBackupSetupData> = Symbol('restore-backup-setup-config');
export const divisionCodeInjectionKey: InjectionKey<Ref<DivisionType>> = Symbol('division-code');
export const currentServerInjectionKey: InjectionKey<Ref<Server | null>> = Symbol('server-info');
export const currentWizardInjectionKey: InjectionKey<Ref<'storage' | 'backup' | 'restore-backup' | null>> =
    Symbol('currentWizard');