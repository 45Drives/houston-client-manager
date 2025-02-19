export interface BackUpManager {
  queryTasks(): BackUpTask[]
  removeTask(task: BackUpTask): void
  schedual(task: BackUpTask): void
}

export interface TaskSchedual {
  repeatFrequency: 'hour' | 'day' | 'week' | 'month'
  startDate: Date
}

export interface BackUpTask {
  schedual: TaskSchedual
  clientID: string
  description: string
  source: string
  target: string
}
