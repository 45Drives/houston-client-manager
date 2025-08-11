import { BackUpTask } from "@45drives/houston-common-lib"

export interface BackUpManager {
  queryTasks(): Promise<BackUpTask[]>
  unschedule(task: BackUpTask): Promise<void>
  schedule(task: BackUpTask, username: string, password: string): Promise<{stdout: string, stderr: string}>
  updateSchedule(task: BackUpTask, username: string, password: string): Promise<void>;
  unscheduleSelectedTasks?(tasks: BackUpTask[]): Promise<void>;
  isFirstBackupNeeded?(host: string, share: string): boolean;
}

export const backupTaskTag = "45drives-setup-wizard-backup-task"