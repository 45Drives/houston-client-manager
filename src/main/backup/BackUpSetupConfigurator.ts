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

  async applyConfig(
    config: BackUpSetupConfig,
    progressCallback: (progress: BackUpSetupProgress) => void
  ) {

    try {

      const total = config.backUpTasks.length + 1;
      progressCallback({ message: "Initializing Backup Setup... please wait", step: 1, total });

      const backUpManager = this.getBackUpManager();

      // If scheduleAllTasks exists on the manager, always prefer it
      if (typeof (backUpManager as any).scheduleAllTasks === "function") {
        await (backUpManager as any).scheduleAllTasks(
          config.backUpTasks,
          config.username,
          config.password,
          (step: number, total: number, message: string) => {
            progressCallback({ step, total, message });
          }
        );
      } else {
        // Fallback for managers without batch scheduling
        for (let i = 0; i < config.backUpTasks.length; i++) {
          const task = config.backUpTasks[i];
          try {
            const { stdout, stderr } = await backUpManager.schedule(task, config.username, config.password);
            progressCallback({
              message: `Back up task added for ${task.source}`,
              step: i + 1,
              total: config.backUpTasks.length + 1
            });
          } catch (error) {
            console.error("Error in setting up backups:", error);
            progressCallback({ message: `Error: ${error}`, step: -1, total: -1 });
          }
        }
      }

      progressCallback({
        message: "All backup tasks scheduled successfully.",
        step: config.backUpTasks.length + 1,
        total: config.backUpTasks.length + 1
      });

      // console.log(config);

      progressCallback({
        message: "All backup tasks scheduled successfully.",
        step: total,
        total,
      });

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
