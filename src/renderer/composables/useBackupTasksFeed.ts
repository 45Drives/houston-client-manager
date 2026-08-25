/**
 * useBackupTasksFeed — one shared backup task + event feed for the dashboard.
 *
 * Several dashboard cards need the same task list. Each one used to own its
 * request, its listener and its own 60s timer, so a single dashboard produced
 * 3 `requestBackUpTasks` and 6 `fetchBackupEvents` per minute — and
 * `fetchBackupEvents` re-reads the whole NDJSON log, re-queries every task and
 * pgreps each running one. This module owns a single listener, a single poll
 * timer and a single in-flight request shared by every consumer.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { IPCRouter, type BackUpTask } from '@45drives/houston-common-lib'

export interface FeedTask extends BackUpTask {
  /** Timestamp of the most recent `backup_end` event for this task. */
  lastRunAt?: Date
  /** Status recorded on that event (`success` / `failure`). */
  lastEventStatus?: string
}

const POLL_INTERVAL_MS = 60_000
/** Collapses the simultaneous mount-time requests from every card into one. */
const TASK_REQUEST_THROTTLE_MS = 2_000
/** Event scans are expensive; one per burst of task responses is enough. */
const EVENT_REQUEST_THROTTLE_MS = 5_000

const tasks = ref<FeedTask[]>([])
const loaded = ref(false)
const runningUuids = ref<string[]>([])

let rawTasks: FeedTask[] = []
let latestEventByUuid: Record<string, { date: Date; status: string }> = {}

let subscribers = 0
let listening = false
let pollTimer: ReturnType<typeof setInterval> | null = null
let lastTaskRequestAt = 0
let lastEventRequestAt = 0
let lastTasksReceivedAt = 0

function applyEvents() {
  tasks.value = rawTasks.map((task) => {
    const event = latestEventByUuid[task.uuid]
    return event ? { ...task, lastRunAt: event.date, lastEventStatus: event.status } : task
  })
}

function requestTasks() {
  const now = Date.now()
  if (now - lastTaskRequestAt < TASK_REQUEST_THROTTLE_MS) return
  lastTaskRequestAt = now
  IPCRouter.getInstance().send('backend', 'action', 'requestBackUpTasks')
}

function requestEvents() {
  const now = Date.now()
  if (now - lastEventRequestAt < EVENT_REQUEST_THROTTLE_MS) return
  lastEventRequestAt = now
  IPCRouter.getInstance().send('backend', 'action', JSON.stringify({ type: 'fetchBackupEvents' }))
}

function onAction(raw: string) {
  let msg: any
  try {
    msg = JSON.parse(raw)
  } catch {
    return
  }

  if (msg?.type === 'sendBackupTasks') {
    rawTasks = Array.isArray(msg.tasks) ? msg.tasks : []
    lastTasksReceivedAt = Date.now()
    loaded.value = true
    applyEvents()
    requestEvents()
    return
  }

  if (msg?.type === 'sendBackupEvents') {
    const latest: Record<string, { date: Date; status: string }> = {}
    for (const event of msg.events ?? []) {
      if (!event?.uuid || !event?.timestamp) continue
      const date = new Date(event.timestamp)
      if (Number.isNaN(date.getTime())) continue
      const prev = latest[event.uuid]
      if (!prev || date > prev.date) latest[event.uuid] = { date, status: event.status ?? '' }
    }
    latestEventByUuid = latest
    runningUuids.value = Array.isArray(msg.runningUuids) ? msg.runningUuids : []
    applyEvents()
  }
}

/**
 * Tasks already held by the feed, or `null` if nothing recent enough is cached.
 * Lets on-demand consumers skip a redundant round-trip while the dashboard is up.
 */
export function peekBackupTasks(maxAgeMs = POLL_INTERVAL_MS): FeedTask[] | null {
  if (!loaded.value) return null
  if (Date.now() - lastTasksReceivedAt > maxAgeMs) return null
  return tasks.value
}

/**
 * Subscribe to the shared feed. Data is fetched on first mount, refreshed every
 * 60s while at least one consumer is mounted, and stops when the last unmounts.
 */
export function useBackupTasksFeed() {
  onMounted(() => {
    subscribers++
    if (!listening) {
      IPCRouter.getInstance().addEventListener('action', onAction)
      listening = true
    }
    if (!pollTimer) pollTimer = setInterval(requestTasks, POLL_INTERVAL_MS)
    requestTasks()
  })

  onBeforeUnmount(() => {
    subscribers = Math.max(0, subscribers - 1)
    if (subscribers > 0) return
    if (listening) {
      IPCRouter.getInstance().removeEventListener('action', onAction)
      listening = false
    }
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  })

  return { tasks, loaded, runningUuids, refresh: requestTasks }
}
