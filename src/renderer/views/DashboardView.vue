<template>
    <div class="h-full flex items-center justify-center">
        <!-- <div>
           Add some information up here + Tooltips?
        </div> -->
        <div class="grid grid-cols-2 gap-10 text-2xl w-9/12 mx-auto">
            <CardContainer class="col-span-1 bg-accent border-default rounded-md">
                <template #header>
                    <button @click="goSetup()" class="btn btn-secondary w-full h-40 text-6xl">
                        SERVER SETUP
                    </button>
                </template>
                <div>
                    <p class="text-lg font-medium">Have new 45Drives Hardware?<br />Click <b>“SERVER SETUP”</b> to have
                        the Houston Wizard get you up and running with our best practice storage architecture!
                    </p>

                </div>
                <template #footer>
                    <p class="mt-4 text-sm italic text-gray-400">We will configure ZFS Pools and Samba
                        Shares so you can use all of your drives that connect to your storage over the network.</p>
                </template>
            </CardContainer>

            <CardContainer class="relative col-span-1 bg-accent border-default rounded-md">
                <template #header>
                    <button @click="goBackup()" class="btn btn-secondary w-full h-40 text-6xl">
                        BACKUP MANAGER
                    </button>
                </template>
                <div>
                    <p class="text-lg font-medium">Want to keep your data safe?<br />Click <b>“BACKUP MANAGER”</b> to
                        open our
                        Backup module, which allows you to manage backups, create/schedule new ones, restore files, and
                        view
                        logs.</p>
                </div>
                <template #footer>
                    <p class="mt-4 text-sm italic text-gray-400">You can backup from this computer to a 45Drives
                        server, or from a 45Drives server to another server, or from a 45Drives server to a cloud
                        provider! <br /></p>
                </template>
            </CardContainer>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import CardContainer from '../components/CardContainer.vue'
import { useHeader } from '../composables/useHeader'
useHeader('45Drives Setup & Backup Wizard')

const router = useRouter()
const goSetup = () => router.push({ name: 'setup' })
const goBackup = () => router.push({ name: 'backup' })


</script>