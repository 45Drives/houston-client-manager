<template>
    <Modal :show="show" @clickOutside="cancel">
        <div class="w-full max-w-md mx-auto bg-default p-4 rounded-xl shadow">
            <h2 class="text-xl font-semibold mb-4">Samba Credentials Needed</h2>

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
                        placeholder="Enter your password" />
                    <button type="button" @click="togglePassword"
                        class="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted">
                        <EyeIcon v-if="!showPassword" class="w-5 h-5" />
                        <EyeSlashIcon v-if="showPassword" class="w-5 h-5" />
                    </button>
                </div>
            </div>

            <div class="flex justify-end gap-2 mt-6">
                <button class="btn btn-secondary" @click="cancel">Cancel</button>
                <button class="btn btn-primary" :disabled="!username || !password" @click="confirm">Continue</button>
            </div>
        </div>
    </Modal>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { EyeIcon, EyeSlashIcon } from "@heroicons/vue/20/solid";
import { Modal } from '@45drives/houston-common-ui';

const show = ref(false);
const username = ref('');
const password = ref('');
const showPassword = ref(false);
const togglePassword = () => {
    showPassword.value = !showPassword.value;
};

let resolver: ((val: { username: string; password: string } | null) => void) | null = null;

function open(): Promise<{ username: string; password: string } | null> {
    username.value = '';
    password.value = '';
    show.value = true;
    return new Promise(resolve => {
        resolver = resolve;
    });
}

function confirm() {
    show.value = false;
    resolver?.({ username: username.value, password: password.value });
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
    @apply text-sm font-medium text-gray-600 mb-1;
}
</style>
  
