import { ref } from 'vue'

export interface LogTaskContext {
  uuid: string
  description?: string
}

const _logModalOpen = ref(false)
const _taskContext = ref<LogTaskContext | null>(null)

export function useLogModal() {
  const open = (task?: LogTaskContext) => {
    _taskContext.value = task ?? null
    _logModalOpen.value = true
  }
  const close = () => {
    _logModalOpen.value = false
    _taskContext.value = null
  }
  const toggle = () => {
    if (_logModalOpen.value) close()
    else open()
  }
  return {
    logModalOpen: _logModalOpen,
    logTaskContext: _taskContext,
    openLogModal: open,
    closeLogModal: close,
    toggleLogModal: toggle,
  }
}
