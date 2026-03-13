<template>
    <div v-if="open" class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40"
        @keydown.esc="$emit('cancel')">
        <div class="bg-well border border-default rounded-lg p-4 w-[28rem] shadow-xl">
            <h3 class="text-lg font-medium mb-2">
                Log in to <span class="font-semibold">{{ hostLabel }}</span>
            </h3>

            <div class="space-y-2">
                <div class="text-xs text-muted -mt-1 mb-1">
                    Tip: You can save this login to avoid entering it next time.
                </div>

                <label class="block text-sm">Username</label>
                <input v-model="model.username" class="input-textlike w-full" placeholder="root"
                    autocomplete="username" />

                <label class="block text-sm mt-2">Password</label>
                <input v-model="model.password" class="input-textlike w-full" placeholder="••••••••" type="password"
                    autocomplete="current-password" />

                <label class="inline-flex items-center gap-2 text-sm mt-2">
                    <input type="checkbox" v-model="model.remember" />
                    Remember / set as favorite on this device
                </label>
            </div>

            <div class="mt-4 flex justify-end gap-2">
                <button class="btn btn-secondary" @click="$emit('cancel')">Cancel</button>
                <button class="btn btn-primary" :disabled="!model.username || !model.password" @click="onSubmit">
                    Continue
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, reactive, watch, toRefs } from 'vue';

const props = defineProps<{
    open: boolean;
    host: string | null;           // the selected IP/FQDN
    displayName?: string | null;   // optional friendly name
    presetUsername?: string | null;
}>();

const emit = defineEmits<{
    cancel: [];
    submit: [{ username: string; password: string; remember: boolean }];
}>();

const model = reactive({
    username: props.presetUsername || '',
    password: '',
    remember: true,
});

watch(() => props.presetUsername, (u) => {
    if (u && !model.username) model.username = u;
});

const hostLabel = computed(() => props.displayName || props.host || 'server');

function onSubmit() {
    emit('submit', {
        username: model.username.trim(),
        password: model.password,
        remember: !!model.remember,
    });
    // scrub the password immediately after emitting
    model.password = '';
}
</script>
