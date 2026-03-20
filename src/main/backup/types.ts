import { BackUpTask } from "@45drives/houston-common-lib"

export type BackupProgressCallback = (percent: number | null, message?: string) => void;

export interface BackUpManager {
  queryTasks(): Promise<BackUpTask[]>
  unschedule(task: BackUpTask): Promise<void>
  schedule(task: BackUpTask, username: string, password: string): Promise<{stdout: string, stderr: string}>
  updateSchedule(task: BackUpTask, username: string, password: string): Promise<void>;
  unscheduleSelectedTasks?(tasks: BackUpTask[]): Promise<void>;
  isFirstBackupNeeded?(host: string, share: string, smbUser: string): boolean;
  scheduleAllTasks?(
    tasks: BackUpTask[],
    username: string,
    password: string,
    onProgress?: (step: number, total: number, message: string) => void
  ): Promise<void>;
  runNow?(task: BackUpTask, onProgress?: BackupProgressCallback): Promise<{ stdout: string; stderr: string }>;
}

export const backupTaskTag = "45drives-setup-wizard-backup-task"