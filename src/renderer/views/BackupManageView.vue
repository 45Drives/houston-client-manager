<template>
    <ManageBackupsView class="h-full flex-1" />
</template>

<script setup lang="ts">
import ManageBackupsView from './backupSetupWizard/ManageBackupsView.vue';
import { provide, reactive } from 'vue';
import { backUpSetupConfigKey, reviewBackUpSetupKey } from '../keys/injection-keys';

provide(backUpSetupConfigKey, reactive({
    backUpTasks: [],
    username: "",
    password: "",
}))

provide(reviewBackUpSetupKey, reactive({ tasks: [] }))
</script>
