// useRebootWatcher.ts
import { ref } from 'vue'
import { reportError } from '@45drives/houston-common-ui'

export function useRebootWatcher() {
  const waiting = ref(false)

  async function waitFor(serverIp: string, timeoutMs = 5 * 60 * 1000) {
    waiting.value = true
    const start = Date.now()
    const sleep = (ms:number) => new Promise(r => setTimeout(r, ms))
    const url = `https://${serverIp}:9090/`

    const ping = async (): Promise<boolean> => {
      try {
        // no-cors: we can't read the response due to CORS, but a successful
        // fetch (even opaque) means the server is reachable. A network error
        // (server down) will throw.
        await fetch(url, { method: 'GET', mode: 'no-cors', cache: 'no-store' })
        return true
      } catch {
        return false
      }
    }

    let serverUp = false
    while (!serverUp && (Date.now() - start) < timeoutMs) {
      serverUp = await ping()
      if (!serverUp) await sleep(5000)
      else {
        // double-check after 5s
        await sleep(5000)
        serverUp = await ping()
      }
    }
    waiting.value = false
    if (!serverUp) { reportError(new Error('Server did not come back online within timeout.')); return false }
    return true
  }

  return { waiting, waitFor }
}
