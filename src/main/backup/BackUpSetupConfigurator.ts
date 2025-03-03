import { BackUpSetupConfig } from "@45drives/houston-common-lib";
import { getOS } from "../utils";
import { BackUpManagerLin } from "./BackUpManagerLin";
import { BackUpManagerMac } from "./BackUpManagerMac";
import { BackUpManagerWin } from "./BackUpManagerWin";
import { BackUpManager } from "./types";

export interface BackUpSetupProgress {
  message: string;
  step: number;
  total: number;
}

export class BackUpSetupConfigurator {

  constructor() {
  }

  async applyConfig(
    config: BackUpSetupConfig,
    progressCallback: (progress: BackUpSetupProgress) => void
  ) {

    try {
      const total = config.backUpTasks.length + 1;
      progressCallback({ message: "Initializing Backup Setup... please wait", step: 1, total });

      const backUpManager = this.getBackUpManager();
      for (let i = 0; i < config.backUpTasks.length; i++) {
        backUpManager.schedule(config.backUpTasks[i]);
        progressCallback({ message: "Back up task added for " + config.backUpTasks[i].source + " added.", step: i + 1, total});
      }
      
      console.log(config);

    } catch (error: any) {
      console.error("Error in setting up backups:", error);
      progressCallback({ message: `Error: ${error.message}`, step: -1, total: -1 });
    }

  }

  private getBackUpManager(): BackUpManager {
    const os = getOS();

    if (os === 'debian' || os == 'rocky') {
      return new BackUpManagerLin();
    } else if (os === 'win') {
      return new BackUpManagerWin();
    } else {
      return new BackUpManagerMac();
    }
  }
}
