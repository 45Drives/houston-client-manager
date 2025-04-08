import type { InjectionKey, Reactive } from "vue";
import type { DivisionType } from "../types";
import type { BackUpSetupConfig, ServerInfo } from "@45drives/houston-common-lib";
export const serverInfoInjectionKey: InjectionKey<Reactive<Partial<ServerInfo>>> = Symbol('server-info');
export const backUpSetupConfigKey: InjectionKey<BackUpSetupConfig> = Symbol('backup-setup-config');
export const divisionCodeInjectionKey: InjectionKey<DivisionType> = Symbol('division-code');
