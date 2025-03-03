import { BackUpManager } from "./types";
import { BackUpTask, TaskSchedule } from "@45drives/houston-common-lib";

export class BackUpManagerMac implements BackUpManager {
  queryTasks(): BackUpTask[] {
    throw new Error("not implemented");
  }
  schedule(_task: BackUpTask): void {
    throw new Error("not implemented");
  }
  unschedule(_task: BackUpTask): void {
    throw new Error("not implemented");
  }
}
