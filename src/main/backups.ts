export interface BackUpManager {
  queryTasks(): BackUpTask[]
  unschedual(task: BackUpTask): void
  schedual(task: BackUpTask): void
}

export interface TaskSchedual {
  repeatFrequency: 'hour' | 'day' | 'week' | 'month'
  startDate: Date
}

export interface BackUpTask {
  schedual: TaskSchedual
  clientID: string
  description: string     // Unique description of the task. Also programatically add ID (Houston-backup-task) so we can query
  source: string          // client folder to backup
  target: string          // mount point for backup location(preappened clientID(client hostname))
}
