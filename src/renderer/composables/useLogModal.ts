import { computed, ref } from 'vue'

export interface LogTaskContext {
  uuid: string
  description?: string
}

const _logModalOpen = ref(false)
const _taskContexts = ref<LogTaskContext[]>([])
const _selectedIndex = ref(0)

export function useLogModal() {
  const open = (taskOrTasks?: LogTaskContext | LogTaskContext[]) => {
    if (Array.isArray(taskOrTasks)) {
      _taskContexts.value = taskOrTasks.length > 0 ? taskOrTasks : []
    } else {
      _taskContexts.value = taskOrTasks ? [taskOrTasks] : []
    }
    _selectedIndex.value = 0
    _logModalOpen.value = true
  }
  const close = () => {
    _logModalOpen.value = false
    _taskContexts.value = []
    _selectedIndex.value = 0
  }
  const toggle = () => {
    if (_logModalOpen.value) close()
    else open()
  }
  const logTaskContext = computed(() =>
    _taskContexts.value.length > 0 ? _taskContexts.value[_selectedIndex.value] ?? null : null
  )
  return {
    logModalOpen: _logModalOpen,
    logTaskContext,
    logTaskContexts: _taskContexts,
    selectedTaskIndex: _selectedIndex,
    openLogModal: open,
    closeLogModal: close,
    toggleLogModal: toggle,
  }
}
