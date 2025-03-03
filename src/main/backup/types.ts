import { BackUpTask } from "@45drives/houston-common-lib"

export interface BackUpManager {
  queryTasks(): BackUpTask[]
  unschedule(task: BackUpTask): void
  schedule(task: BackUpTask): void
}

export const backupTaskTag = "houston-client-manager-backup-task"