import type { InjectionKey, Reactive } from "vue";
import type { BackUpSetupConfig, ServerInfo } from "@45drives/houston-common-lib";

export const serverInfoInjectionKey: InjectionKey<Reactive<Partial<ServerInfo>>> = Symbol('server-info');
export const backUpSetupConfigKey: InjectionKey<Reactive<BackUpSetupConfig>> = Symbol('backup-setup-config');