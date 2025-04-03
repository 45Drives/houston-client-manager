import { BackUpTask } from "@45drives/houston-common-lib"

export interface BackUpManager {
  queryTasks(): Promise<BackUpTask[]>
  unschedule(task: BackUpTask): void
  schedule(task: BackUpTask): Promise<{stdout: string, stderr: string}>
}

export const backupTaskTag = "45drives-setup-wizard-backup-task"