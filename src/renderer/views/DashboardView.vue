<template>
    <div class="w-screen h-screen flex flex-col bg-gray-900 text-white">
        <!-- Header -->
     
        <div class="relative flex items-center justify-center h-18 w-full">
            <div class="absolute left-0 p-1 px-4 rounded-lg">
                <DynamicBrandingLogo :division="divisionCode" />
            </div>
            <p class="text-3xl font-semibold text-center">
                Restore Backups
            </p>
            <div class="absolute right-0 top-1/2 -translate-y-1/2">
                <GlobalSetupWizardMenu />
            </div>
        </div>

        <!-- Cards Section -->
        <main class="flex-1 p-6 overflow-auto">
            <div class="grid grid-cols-3 md:grid-cols-3 gap-6 mb-6">
                <!-- Setup Card -->
                <!-- <div class="bg-gray-800 rounded-xl p-6 flex flex-col justify-between">
                    <div>
                        <p class="text-lg font-medium">Have new 45Drives Hardware?<br />Click “SETUP” to have the
                            Houston Wizard get you up and running with our best practice storage architecture!</p>
                        <p class="mt-4 text-sm italic text-gray-400">We will configure ZFS Pools and Samba Shares so you
                            can use all of your drives that connect to your storage over the network.</p>
                    </div>
                    <button @click="onSetup"
                        class="mt-6 self-center bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-8 rounded-full uppercase">SETUP</button>
                </div> -->

                <!-- Backup Card -->
                <!-- <div class="bg-gray-800 rounded-xl p-6 flex flex-col justify-between">
                    <div>
                        <p class="text-lg font-medium">Want to keep your data safe?<br />Click “BACKUP” to open our
                            Backup module, which allows you to backup data from this computer to the server, or from
                            this server to another.</p>
                        <p class="mt-4 text-sm italic text-gray-400">You can backup from this computer to a 45Drives
                            server, or from a 45Drives server to another server, or from a 45Drives server to a cloud
                            provider!</p>
                    </div>
                    <button @click="onBackup"
                        class="mt-6 self-center bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-8 rounded-full uppercase">BACKUP</button>
                </div> -->

                <!-- Restore Card -->
                <!-- <div class="bg-gray-800 rounded-xl p-6 flex flex-col justify-between">
                    <div>
                        <p class="text-lg font-medium">Lost data? Don’t worry, click “RESTORE” to open our Restore
                            module, which allows you to restore files from a server to this computer, or rollback
                            snapshots on the server itself.</p>
                        <p class="mt-4 text-sm italic text-gray-400">You can restore snapshots from server to server or
                            select individual files to restore on this computer. You can also restore an entire
                            directory from a cloud backup!</p>
                    </div>
                    <button @click="onRestore"
                        class="mt-6 self-center bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-8 rounded-full uppercase">RESTORE</button>
                </div> -->
            </div>

            <!-- Footer Section -->
            <!-- <div class="bg-gray-800 rounded-xl p-6 flex flex-col md:flex-row items-start md:items-center">
                <div class="w-full md:w-1/3 mb-6 md:mb-0">
                    <h3 class="text-xs font-bold uppercase text-gray-400 mb-2">Detected Servers</h3>
                    <ul class="divide-y divide-gray-700">
                        <li v-for="srv in servers" :key="srv.ip" class="py-2 flex items-center">
                            <label class="flex items-center w-full cursor-pointer">
                                <input type="radio" class="form-radio h-4 w-4 text-red-600" v-model="selectedServerIp"
                                    :value="srv.ip" />
                                <span class="ml-2">{{ srv.name }} - {{ srv.ip }}</span>
                            </label>
                        </li> 
                    </ul>
                <div class="flex-1 pl-0 md:pl-6 flex flex-col justify-center">
                    <p class="mb-4 text-gray-300">Here is a list of servers that have already been configured, you can
                        select one and then click on “Manage Server” to view the server metrics and make changes, or
                        click “Houston UI” to see the full Houston Web UI.</p>
                    <div class="flex space-x-4">
                        <button @click="onManageServer" :disabled="!selectedServerIp"
                            class="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-semibold py-2 px-6 rounded-full uppercase">
                            Manage Server
                        </button>
                        <button @click="onOpenHoustonUI" :disabled="!selectedServerIp"
                            class="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-semibold py-2 px-6 rounded-full uppercase">
                            Houston UI
                        </button>
                    </div>
                </div>
            </div> -->
        </main>
    </div>
</template>

<script setup lang="ts">
import { ref, provide, inject } from 'vue';
import GlobalSetupWizardMenu from '../components/GlobalSetupWizardMenu.vue';
import { DynamicBrandingLogo } from '@45drives/houston-common-ui';
import { useAdvancedModeState } from '../composables/useAdvancedState';
import { Server, DivisionType, DiscoveryState } from '../types';
import { GlobalModalConfirm, Notification, reportError, reportSuccess, useDarkModeState, NotificationView, pushNotification } from '@45drives/houston-common-ui'
import StorageSetupWizard from './views/storageSetupWizard/Wizard.vue';
import BackUpSetupWizard from './views/backupSetupWizard/Wizard.vue';
import RestoreBackUpWizard from './views/restoreBackupWizard/Wizard.vue';
import { divisionCodeInjectionKey, currentServerInjectionKey, currentWizardInjectionKey, thisOsInjectionKey, discoveryStateInjectionKey } from '../keys/injection-keys';
import { IPCMessageRouterRenderer, IPCRouter } from '@45drives/houston-common-lib';
import DashboardView from './views/DashboardView.vue';

const thisOS = ref<string>('');
const setOs = (value: string) => {
    thisOS.value = value;
};
const divisionCode = ref<DivisionType>('default');
const showWebView = ref<boolean>(false);

provide(divisionCodeInjectionKey, divisionCode);

// Sample detected servers; replace with real discovery logic
// const servers = ref<Server[]>([
//     { name: 'hl4.local', ip: '192.168.1.10' },
//     { name: 'hl8.local', ip: '192.168.1.11' }
// ]);
const selectedServerIp = ref<string | null>(null);

function onSetup() {
    // TODO: trigger storage setup wizard
    console.debug('Setup clicked');
}

function onBackup() {
    // TODO: trigger backup wizard
    console.debug('Backup clicked');
}

function onRestore() {
    // TODO: trigger restore wizard
    console.debug('Restore clicked');
}

function onManageServer() {
    if (!selectedServerIp.value) return;
    // TODO: navigate to manage view for selectedServerIp
    console.debug('Manage Server:', selectedServerIp.value);
}

function onOpenHoustonUI() {
    if (!selectedServerIp.value) return;
    // TODO: use Electron API to open new window
    console.debug('Open Houston UI:', selectedServerIp.value);
}
</script>

<style scoped>
/* No additional styles; all layout via Tailwind classes */
</style>
