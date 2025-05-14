<template>
	<CardContainer>
		<template #header class="!text-center">
			<div class="relative flex items-center justify-center h-18  w-full">
				<div class="absolute left-0 p-1 px-4 rounded-lg">
					<DynamicBrandingLogo :division="division" />
				</div>
				<p class="text-3xl font-semibold text-center">
					Create Simple Backup Plan!
				</p>
				<div class="absolute right-0 top-1/2 -translate-y-1/2">
					<GlobalSetupWizardMenu />
				</div>
			</div>
		</template>

		<div class="flex flex-col max-h-[calc(100vh-12rem)] min-h-0 flex-1 overflow-hidden">
			<div class="flex flex-col h-full min-h-0">
				<div class="flex flex-col flex-1 min-h-0 overflow-hidden w-9/12 mx-auto text-left space-y-2">
					<div class="text-center shrink-0">
						<p class="mb-2 text-2xl">
							Choose the folders you want to back up and choose how often you want to back it up.
						</p>
						<p class="mb-2 text-2xl">
							File explorer may open on different screen when you click the add folder button "+".
						</p>
					</div>

					<div class="shrink-0 space-y-2 overflow-hidden w-full">
						<!-- Backup Location -->
						<div class="flex items-center">
							<div class="flex items-center w-[25%] flex-shrink-0 space-x-2">
								<label class="text-default font-semibold text-left">Back Up Location</label>
								<CommanderToolTip
									:message="`This is the designated backup storage location you set up earlier.`" />
							</div>
							<select v-model="selectedServer"
								class="bg-default h-[3rem] text-default rounded-lg px-4 flex-1 border border-default">
								<option v-for="item in servers" :key="item.ip" :value="item">
									{{ `\\\\${item.name}\\${item.shareName}` }}
								</option>
							</select>
						</div>

						<!-- Backup Frequency -->
						<div class="shrink-0 flex flex-row items-center py-2">
							<label class="w-[25%] text-default font-semibold text-start">
								Backup Interval <span v-if="scheduleFrequency != 'hour'">(Starts At 12:00 AM
									(Midnight)):</span>
							</label>
							<select v-model="scheduleFrequency"
								class="bg-default h-[3rem] text-default rounded-lg px-4 flex-1 border border-default">
								<option value="hour">Hourly</option>
								<option value="day">Daily</option>
								<option value="week">Weekly</option>
								<option value="month">Monthly</option>
							</select>
						</div>

						<!-- Folder Selection Button -->
						<div class="flex flex-row items-center mt-4">
							<button @click="handleFolderSelect" class="btn btn-secondary h-10 w-15">
								<PlusIcon class="w-6 h-6 text-white" />
							</button>
							<p class="text-start ml-2 font-semibold text-lg">
								Select a folder to back up to the designated location.
							</p>
							<CommanderToolTip class="ml-4"
								:message="`Click the plus icon to select a folder for backup. You can add multiple locations by selecting them one at a time.`" />
						</div>

						<!-- Selected Folders List -->
						<div v-if="backUpSetupConfig?.backUpTasks.length! > 0"
							class="overflow-y-auto max-h-[40vh] border border-default rounded-lg shadow-inner bg-well p-2 space-y-4">
							<div v-for="(folder, index) in selectedFolders" :key="folder.path"
								class="flex items-center p-2">
								<div class="w-[25%] flex-shrink-0 space-x-2 flex items-center">
									<label class="text-default font-semibold text-left">{{ folder.name }}</label>
								</div>
								<input disabled :value="folder.path"
									class="bg-default h-[3rem] mr-4 text-default rounded-lg px-4 flex-1 border border-default" />
								<button @click="removeFolder(index)" class="btn btn-secondary">
									<MinusIcon class="w-6 h-6 text-white" />
								</button>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>

		<!-- Buttons -->
		<template #footer>
			<div class="button-group-row justify-between">
				<button @click="proceedToPreviousStep" class="btn btn-primary h-20 w-40">
					Back
				</button>
				<button :disabled="backUpSetupConfig?.backUpTasks.length === 0" @click="proceedToNextStep"
					class="absolute btn right-[1rem] btn-primary h-20 w-40">
					Next
				</button>
			</div>
		</template>
		<MessageDialog ref="messageFolderAlreadyAdded" message="⚠️ Folder is already added." />
		<MessageDialog ref="messageSubFolderAlreadyAdded"
			message="⚠️ A subfolder of this folder is already added. Please remove it first." />
		<MessageDialog ref="messageParentFolderAlreadyAdded"
			message="⚠️ A parent folder is already added. You cannot add a subfolder." />

	</CardContainer>
</template>

<script setup lang="ts">
import { CardContainer, CommanderToolTip, confirm, useEnterToAdvance } from "@45drives/houston-common-ui";
import { inject, onMounted, ref, watch } from "vue";
import { PlusIcon, MinusIcon } from "@heroicons/vue/20/solid";
import { useWizardSteps, DynamicBrandingLogo } from '@45drives/houston-common-ui';
import { Server } from '../../types'
import { backUpSetupConfigKey, divisionCodeInjectionKey } from "../../keys/injection-keys";
import MessageDialog from '../../components/MessageDialog.vue';
import { BackUpTask, IPCMessageRouter, IPCRouter, server, unwrap } from "@45drives/houston-common-lib";
import GlobalSetupWizardMenu from '../../components/GlobalSetupWizardMenu.vue';
import { sanitizeFilePath } from "./utils";

const division = inject(divisionCodeInjectionKey);
// Wizard navigation
const { completeCurrentStep, prevStep } = useWizardSteps("backup");

// Reactive State
const backUpSetupConfig = inject(backUpSetupConfigKey);

const selectedFolders = ref<{ name: string; path: string }[]>([]);
const scheduleFrequency = ref<"hour" | "day" | "week" | "month">("hour");

const servers = ref<Server[]>([]);
const selectedServer = ref<Server | null>(null);
const isSelectingFolder = ref(false);
const messageFolderAlreadyAdded = ref<InstanceType<typeof MessageDialog> | null>(null);
const messageSubFolderAlreadyAdded = ref<InstanceType<typeof MessageDialog> | null>(null);
const messageParentFolderAlreadyAdded = ref<InstanceType<typeof MessageDialog> | null>(null);

function areArraysEqual(arr1: Server[], arr2: Server[]): boolean {
	if (arr1.length !== arr2.length) {
		return false; // Arrays have different lengths
	}

	return arr1.every((value, index) => {
		const server1: Server = value;
		const server2: Server = arr2[index];

		return server1.ip === server2.ip;

	});
}

// Receive the discovered servers from the main process
window.electron.ipcRenderer.on('discovered-servers', (_event, discoveredServers: Server[]) => {
	if (!areArraysEqual(discoveredServers, servers.value)) {
		console.log("Discovered servers:", discoveredServers)
		servers.value = discoveredServers;
		if (discoveredServers.length > 0) {

			const tasks = backUpSetupConfig?.backUpTasks;
			if (tasks && tasks.length > 0) {

				const task = tasks[0];
				const target = task.target;

				const potentialServer = discoveredServers.find(server => target.includes(server.ip));
				if (potentialServer) {

					selectedServer.value = potentialServer;
				} else {
					selectedServer.value = discoveredServers[0];
				}

			} else {

				selectedServer.value = discoveredServers[0];
			}

		}
	}
});

//  Watch and Update Tasks When Schedule Changes
watch(scheduleFrequency, (newSchedule) => {

	if (backUpSetupConfig) {

		backUpSetupConfig.backUpTasks = backUpSetupConfig.backUpTasks.map((task) => {
			task.schedule.repeatFrequency = newSchedule;
			task.schedule.startDate = getNextScheduleDate(newSchedule)
			console.log("some update task.startDate:", task.schedule.startDate);
			return task;
		});
	}
});


//  Sync `selectedFolders` with `backUpSetupConfig.backUpTasks`
const loadExistingFolders = () => {
	selectedFolders.value = (backUpSetupConfig?.backUpTasks ?? []).map(task => ({
		name: task.source?.split("/").pop() ?? "Unknown Folder",
		path: task.source
	}));
};
onMounted(loadExistingFolders);

// Normalize path function for cross-platform compatibility
const normalizePath = (path: string) =>
	path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase(); // Normalize for consistency

watch(
	() => backUpSetupConfig?.backUpTasks.length,
	(newLength, oldLength) => {
		if (newLength !== oldLength) {
			selectedFolders.value = (backUpSetupConfig?.backUpTasks || []).map(task => ({
				name: task.description,
				path: task.source
			}))
		}
	},
	{ immediate: true } // triggers on mount too
)


const handleFolderSelect = async () => {
	if (isSelectingFolder.value) return; // Prevent multiple popups
	isSelectingFolder.value = true;

	if (!window.electron?.selectFolder) {
		console.error("Electron API not available! Ensure preload script is loaded.");
		isSelectingFolder.value = false;
		return;
	}

	try {
		const folderPath = await window.electron.selectFolder();
		if (!folderPath) return;

		const normalizedFolderPath = normalizePath(folderPath); // Normalize for consistency
		const folderName = normalizedFolderPath.split("/").pop() ?? "Unknown Folder";

		if (backUpSetupConfig?.backUpTasks) {
			const existingFolders = backUpSetupConfig.backUpTasks.map((task) =>
				normalizePath(task.source.trim())
			);

			//  Prevent Duplicate Folder Selection (Case-Insensitive)
			if (existingFolders.includes(normalizedFolderPath)) {
				messageFolderAlreadyAdded.value?.show();
				return;
			}

			//  Prevent Adding a Child Folder if Parent is Already in the List
			if (existingFolders.some((existingPath: string) =>
				normalizedFolderPath.startsWith(existingPath + "/") || normalizedFolderPath.startsWith(existingPath + "\\")
			)) {
				messageParentFolderAlreadyAdded.value?.show();

				return;
			}

			//  Prevent Adding a Parent Folder if Any Child is Already in the List
			if (existingFolders.some((existingPath: string) =>
				existingPath.startsWith(normalizedFolderPath + "/") || existingPath.startsWith(normalizedFolderPath + "\\")
			)) {
				messageSubFolderAlreadyAdded.value?.show();

				return;
			}


			//  Add New Folder if No Conflicts
			const newTask: BackUpTask = {
				schedule: { startDate: getNextScheduleDate(scheduleFrequency.value), repeatFrequency: scheduleFrequency.value },
				description: `Backup task for ${folderName}`,
				source: folderPath,
				target: `\\\\${selectedServer.value?.name}.local\\${selectedServer.value?.shareName}`,
				mirror: false,
				uuid: crypto.randomUUID(),
			};

			console.log("NewTask.Startdate:", newTask.schedule.startDate);

			backUpSetupConfig.backUpTasks.push(newTask);
			selectedFolders.value.push({ name: folderName, path: folderPath });
			if (!backUpSetupConfig?.backUpTasks) {
				selectedFolders.value = []
			}
		}
	} catch (error) {
		console.error("Error selecting folder:", error);
	} finally {
		isSelectingFolder.value = false; // Reset state after operation
	}
};
//  Remove Folder from List
const removeFolder = (index: number) => {
	selectedFolders.value.splice(index, 1);
	if (backUpSetupConfig) {
		const newBackUpTasks = [...backUpSetupConfig?.backUpTasks];
		newBackUpTasks.splice(index, 1);
		backUpSetupConfig.backUpTasks = newBackUpTasks;
	}
};

function getNextScheduleDate(frequency: 'hour' | 'day' | 'week' | 'month'): Date {
	const now = new Date();
	const nextDate = new Date(now);

	switch (frequency) {
		case 'hour':
			nextDate.setMinutes(0, 0, 0);
			nextDate.setHours(now.getHours() + 1);
			break;

		case 'day':
			nextDate.setHours(0, 0, 0, 0);
			if (now >= nextDate) {
				nextDate.setDate(nextDate.getDate() + 1);
			}
			break;

		case 'week':
			nextDate.setHours(0, 0, 0, 0);
			nextDate.setDate(now.getDate() + 7);
			break;

		case 'month':
			nextDate.setHours(9, 0, 0, 0);
			const currentDay = now.getDate();
			nextDate.setDate(currentDay);
			nextDate.setMonth(now.getMonth() + 1);
			if (nextDate.getDate() < currentDay) {
				nextDate.setDate(0); // fallback to end of month
			}
			break;
	}
	console.log("nextDate ", nextDate)

	return nextDate;
}

let hostname = ""
IPCRouter.getInstance().addEventListener("action", (data) => {
	try {
		const jsondata = JSON.parse(data);

		if (jsondata.type === "sendHostname") {
			hostname = sanitizeFilePath(jsondata.hostname);
		}
	} catch (_e) { }
})


IPCRouter.getInstance().send("backend", "action", "requestHostname");

// Navigation
const proceedToNextStep = () => {

	backUpSetupConfig?.backUpTasks.forEach(
		(task: BackUpTask) => {
			const targetDirForSourcePart = sanitizeFilePath(task.source);
			const slashOrNotSlash = targetDirForSourcePart.startsWith("/") ? "" : "/";

			task.target = `${selectedServer.value!.name}.local:${selectedServer.value!.shareName!}/${task.uuid}/${hostname}${slashOrNotSlash}${targetDirForSourcePart}`;
			console.log('target saved:', task.target);
		});

	completeCurrentStep();
}
const proceedToPreviousStep = () => prevStep();

useEnterToAdvance(
	() => {
		if (backUpSetupConfig!.backUpTasks.length > 0) {
			proceedToNextStep(); // Enter
		}
	},
	200,
	() => {
		if (backUpSetupConfig!.backUpTasks.length > 0) {
			proceedToNextStep(); // → Arrow
		}
	},
	() => {
		proceedToPreviousStep(); // ← Arrow
	}
);
</script>
