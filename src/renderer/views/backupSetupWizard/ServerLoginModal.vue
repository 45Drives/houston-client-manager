<template>
    <div v-if="open" class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40"
        @keydown.esc="$emit('cancel')">
        <div class="bg-well border border-default rounded-lg p-4 w-[28rem] shadow-xl">
            <h3 class="text-lg font-medium mb-2">
                Log in to <span class="font-semibold">{{ hostLabel }}</span>
            </h3>

            <div class="space-y-2">
                <div v-if="requirePassword" class="text-xs text-amber-600 dark:text-amber-400 -mt-1 mb-1">
                    Server password is required for the management interface (Cockpit).
                </div>
                <div v-else class="text-xs text-muted -mt-1 mb-1">
                    Tip: You can save this login to avoid entering it next time.
                </div>

                <label class="block text-sm">Username</label>
                <input v-model="model.username" class="input-textlike w-full" placeholder="root"
                    autocomplete="username" />

                <label class="block text-sm mt-2">Password</label>
                <div class="relative">
                    <input v-model="model.password" class="input-textlike w-full pr-10" placeholder="••••••••"
                        :type="showPassword ? 'text' : 'password'"
                        autocomplete="current-password" :disabled="!requirePassword && model.authMethod === 'key'" />
                    <button type="button" tabindex="-1"
                        class="absolute inset-y-0 right-0 flex items-center px-2.5 text-muted hover:text-default transition-colors"
                        @click="showPassword = !showPassword">
                        <EyeSlashIcon v-if="showPassword" class="w-5 h-5" />
                        <EyeIcon v-else class="w-5 h-5" />
                    </button>
                </div>

                <!-- Advanced: SSH Key Auth (hidden when password is required for Cockpit) -->
                <details v-if="!requirePassword" class="text-xs mt-2">
                    <summary class="cursor-pointer text-muted hover:text-default select-none font-medium">Advanced: Use SSH Key</summary>
                    <div class="mt-2 space-y-2 pl-2 border-l-2 border-neutral-200 dark:border-neutral-700">
                        <label class="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" :checked="model.authMethod === 'key'"
                                @change="model.authMethod = ($event.target as HTMLInputElement).checked ? 'key' : 'password'"
                                class="rounded border-neutral-400 dark:border-neutral-500 text-blue-500 focus:ring-blue-500" />
                            <span class="text-xs text-default">Authenticate with SSH private key</span>
                        </label>
                        <div v-if="model.authMethod === 'key'" class="space-y-2">
                            <div class="flex items-center gap-2">
                                <input v-model="model.sshKeyPath" type="text" placeholder="/path/to/id_rsa" readonly
                                    class="flex-1 input-textlike rounded-md px-2 py-1.5 text-sm bg-neutral-50 dark:bg-neutral-800" />
                                <button type="button" @click="browseSshKey"
                                    class="px-2 py-1.5 text-xs font-medium rounded-md border border-neutral-300 dark:border-neutral-600 hover:bg-hover transition-colors">
                                    Browse…
                                </button>
                            </div>
                            <div>
                                <label class="text-xs text-muted mb-1 block">Key Passphrase (optional)</label>
                                <input v-model="model.sshPassphrase" type="password" placeholder="Leave empty if none"
                                    class="w-full input-textlike rounded-md px-2 py-1.5 text-sm" />
                            </div>
                        </div>
                    </div>
                </details>

                <label class="inline-flex items-center gap-2 text-sm mt-2">
                    <input type="checkbox" v-model="model.remember" />
                    Remember / set as favorite on this device
                </label>
            </div>

            <div class="mt-4 flex justify-end gap-2">
                <button class="btn btn-sm btn-outline-shadow h-fit" @click="$emit('cancel')">Cancel</button>
                <button class="btn btn-sm btn-primary h-fit" :disabled="!canSubmit" @click="onSubmit">
                    Continue
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch, toRefs } from 'vue';
import { EyeIcon, EyeSlashIcon } from '@heroicons/vue/24/outline';

const props = defineProps<{
    open: boolean;
    host: string | null;           // the selected IP/FQDN
    displayName?: string | null;   // optional friendly name
    presetUsername?: string | null;
    /** When true, password is mandatory (Cockpit PAM login) and SSH key option is hidden */
    requirePassword?: boolean;
}>();

const emit = defineEmits<{
    cancel: [];
    submit: [{ username: string; password: string; remember: boolean; authMethod?: 'password' | 'key'; sshKeyPath?: string; sshPassphrase?: string }];
}>();

const showPassword = ref(false);

const model = reactive({
    username: props.presetUsername || '',
    password: '',
    authMethod: 'password' as 'password' | 'key',
    sshKeyPath: '',
    sshPassphrase: '',
    remember: true,
});

watch(() => props.presetUsername, (u) => {
    if (u && !model.username) model.username = u;
});

const hostLabel = computed(() => props.displayName || props.host || 'server');

const canSubmit = computed(() => {
    if (!model.username) return false;
    if (props.requirePassword) return !!model.password;
    if (model.authMethod === 'key') return !!model.sshKeyPath;
    return !!model.password;
});

async function browseSshKey() {
    const filePath = await window.electron?.ipcRenderer.invoke('dialog:openSshKey');
    if (filePath) model.sshKeyPath = filePath;
}

function onSubmit() {
    emit('submit', {
        username: model.username.trim(),
        password: model.password,
        remember: !!model.remember,
        authMethod: model.authMethod,
        sshKeyPath: model.sshKeyPath || undefined,
        sshPassphrase: model.sshPassphrase || undefined,
    });
    // scrub the password immediately after emitting
    model.password = '';
    model.sshPassphrase = '';
}
</script>
