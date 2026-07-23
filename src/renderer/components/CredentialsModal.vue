<template>
    <Modal :show="show" @clickOutside="cancel">
        <div class="w-full max-w-md mx-auto bg-default p-4 rounded-xl shadow">
            <h2 class="text-xl font-semibold mb-4">Server Login Required</h2>

            <div class="flex flex-col gap-4 mt-4 text-default">
                <div class="grid relative grid-cols-[200px_1fr] items-center">
                    <label for="username" class="font-semibold ">Username:</label>
                    <input v-enter-next v-model="username" type="text" id="username"
                        class="p-2 input-textlike rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Enter your username" />
                </div>

                <div class="grid relative grid-cols-[200px_1fr] items-center">
                    <label for="password" class="font-semibold ">Password:</label>
                    <input v-model="password" v-enter-next :type="showPassword ? 'text' : 'password'" id="password"
                        class="bg-default p-2 input-textlike rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Enter your password" :disabled="authMethod === 'key'" />
                    <button type="button" @click="togglePassword"
                        class="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted">
                        <EyeIcon v-if="!showPassword" class="w-5 h-5" />
                        <EyeSlashIcon v-if="showPassword" class="w-5 h-5" />
                    </button>
                </div>
            </div>

            <!-- Advanced: SSH Key Auth -->
            <details class="text-xs mt-4">
                <summary class="cursor-pointer text-muted hover:text-default select-none font-medium">Advanced: Use SSH Key</summary>
                <div class="mt-2 space-y-2 pl-2 border-l-2 border-neutral-200 dark:border-neutral-700">
                    <label class="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" :checked="authMethod === 'key'"
                            @change="authMethod = ($event.target as HTMLInputElement).checked ? 'key' : 'password'"
                            class="rounded border-neutral-400 dark:border-neutral-500 text-blue-500 focus:ring-blue-500" />
                        <span class="text-xs text-default">Authenticate with SSH private key instead of password</span>
                    </label>
                    <div v-if="authMethod === 'key'" class="space-y-2">
                        <div class="flex items-center gap-2">
                            <input v-model="sshKeyPath" type="text" placeholder="/path/to/id_rsa" readonly
                                class="flex-1 input-textlike rounded-md px-2 py-1.5 text-sm bg-neutral-50 dark:bg-neutral-800" />
                            <button type="button" @click="browseSshKey"
                                class="px-2 py-1.5 text-xs font-medium rounded-md border border-neutral-300 dark:border-neutral-600 hover:bg-hover transition-colors">
                                Browse…
                            </button>
                        </div>
                        <div>
                            <label class="text-xs text-muted mb-1 block">Key Passphrase (optional)</label>
                            <input v-model="sshPassphrase" type="password" placeholder="Leave empty if none"
                                class="w-full input-textlike rounded-md px-2 py-1.5 text-sm" />
                        </div>
                    </div>
                </div>
            </details>

            <div class="flex justify-end gap-2 mt-6">
                <button class="btn btn-sm btn-outline-shadow h-fit" @click="cancel">Cancel</button>
                <button class="btn btn-sm btn-primary h-fit" :disabled="!canConfirm" @click="confirm">Continue</button>
            </div>
        </div>
    </Modal>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { EyeIcon, EyeSlashIcon } from "@heroicons/vue/20/solid";
import { Modal } from '@45drives/houston-common-ui';

export interface CredentialsResult {
    username: string;
    password: string;
    authMethod: 'password' | 'key';
    sshKeyPath?: string;
    sshPassphrase?: string;
}

const show = ref(false);
const username = ref('');
const password = ref('');
const authMethod = ref<'password' | 'key'>('password');
const sshKeyPath = ref('');
const sshPassphrase = ref('');
const showPassword = ref(false);
const togglePassword = () => {
    showPassword.value = !showPassword.value;
};

const canConfirm = computed(() => {
    if (!username.value) return false;
    if (authMethod.value === 'key') return !!sshKeyPath.value;
    return !!password.value;
});

async function browseSshKey() {
    const filePath = await window.electron?.ipcRenderer.invoke('dialog:openSshKey');
    if (filePath) sshKeyPath.value = filePath;
}

let resolver: ((val: CredentialsResult | null) => void) | null = null;

function open(): Promise<CredentialsResult | null> {
    username.value = '';
    password.value = '';
    authMethod.value = 'password';
    sshKeyPath.value = '';
    sshPassphrase.value = '';
    show.value = true;
    return new Promise(resolve => {
        resolver = resolve;
    });
}

function confirm() {
    show.value = false;
    resolver?.({
        username: username.value,
        password: password.value,
        authMethod: authMethod.value,
        sshKeyPath: sshKeyPath.value || undefined,
        sshPassphrase: sshPassphrase.value || undefined,
    });
    resolver = null;
}

function cancel() {
    show.value = false;
    resolver?.(null);
    resolver = null;
}

// Export open method to parent component
defineExpose({ open });
</script>

<style scoped>
.input {
    @apply border border-default rounded px-3 py-2 text-base;
}

.text-label {
    @apply text-sm font-medium text-gray-600 dark:text-gray-300 mb-1;
}
</style>
  
