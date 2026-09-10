<template>
    <Modal :show="!!pending" @clickOutside="cancel">
        <div class="w-full max-w-sm mx-auto bg-default p-5 rounded-xl shadow">
            <div class="flex items-start gap-3 mb-3">
                <ShieldExclamationIcon class="w-6 h-6 text-amber-500 shrink-0 mt-0.5" />
                <div class="min-w-0">
                    <h2 class="text-base font-semibold text-default">Confirm Admin Password</h2>
                    <p class="text-xs text-gray-400 mt-0.5">
                        This change removes or overwrites something already on the server, so it
                        needs your admin password again.
                    </p>
                </div>
            </div>

            <div class="rounded-md bg-neutral-100 dark:bg-neutral-900 p-2.5 mb-3 space-y-1">
                <p class="text-xs text-default font-medium break-words">{{ pending?.label }}</p>
                <p class="text-[11px] text-gray-400 break-all">
                    {{ pending?.username }}@{{ pending?.host }}
                </p>
            </div>

            <label class="text-xs font-medium text-gray-500 mb-1 block">Admin Password</label>
            <div class="relative">
                <input ref="input" v-model="password" :type="reveal ? 'text' : 'password'"
                    class="w-full p-2 pr-10 input-textlike rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Password for this server" @keyup.enter="confirm" />
                <button type="button" class="absolute right-3 top-1/2 -translate-y-1/2 text-muted"
                    @click="reveal = !reveal">
                    <EyeIcon v-if="!reveal" class="w-4 h-4" />
                    <EyeSlashIcon v-else class="w-4 h-4" />
                </button>
            </div>

            <p v-if="pending?.error" class="mt-2 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded-md">
                {{ pending.error }}
            </p>

            <p class="text-[11px] text-gray-400 mt-2">
                Verified against the server itself. Stays valid for 5 minutes.
            </p>

            <div class="flex justify-end gap-2 mt-5">
                <button class="btn btn-sm btn-outline-shadow h-fit" @click="cancel">Cancel</button>
                <button class="btn btn-sm btn-danger h-fit" :disabled="!password" @click="confirm">Confirm</button>
            </div>
        </div>
    </Modal>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { Modal } from '@45drives/houston-common-ui'
import { ShieldExclamationIcon } from '@heroicons/vue/24/outline'
import { EyeIcon, EyeSlashIcon } from '@heroicons/vue/20/solid'
import { useAdminGatePrompt } from '../composables/useAdminGate'

const { pending, submit, cancel: cancelPrompt } = useAdminGatePrompt()

const password = ref('')
const reveal = ref(false)
const input = ref<HTMLInputElement | null>(null)

watch(pending, async p => {
    password.value = ''
    reveal.value = false
    if (p) {
        await nextTick()
        input.value?.focus()
    }
})

function confirm() {
    if (!password.value) return
    const value = password.value
    password.value = ''
    submit(value)
}

function cancel() {
    password.value = ''
    cancelPrompt()
}
</script>
