import { BackUpSetupConfig } from "@45drives/houston-common-lib";

export class BackUpSetupConfigGlobal {
  private static instance: BackUpSetupConfig | null = null;

  private constructor() {}

  public static getInstance(): BackUpSetupConfig {
    if (!BackUpSetupConfigGlobal.instance) {
      BackUpSetupConfigGlobal.instance = {
        backUpTasks: [],
      }
    }
    return BackUpSetupConfigGlobal.instance;
  }
}

