<template>
	<CardContainer>
		<template #header class="!text-center">
			<div class="relative flex items-center justify-center h-18">
				<div class="absolute left-0 bg-white p-1 px-4 rounded-lg">
					<DynamicBrandingLogo :division="division" />
				</div>
				<p class="text-3xl font-semibold text-center">
					Customize Backup Plan
				</p>
			</div>
		</template>

		<div class="w-9/12 mx-auto text-center">
			<div class="text-center">
				<p class="mb-6 text-2xl">
					Choose the folders you want to back up and choose how often you want to back it up.
				</p>
				<p class="mb-6 text-2xl">
					File explorer may open on different screen when you click the add folder button "+".
				</p>
			</div>

			<div class="flex flex-col space-y-4 mt-[5rem]">
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

				<!-- Folder Selection Button -->
				<div class="flex items-center">
					<button @click="handleFolderSelect" class="relative btn btn-secondary h-10 w-15">
						<PlusIcon class="w-6 h-6 text-white-500" />
					</button>

					<p class="mb-0.5 text-start ml-[1rem] px-4 py-4 font-semibold text-lg flex-shrink-0">
						Select a folder to back up to the designated location.
					</p>
					<CommanderToolTip class="flex-1"
						:message="`Click the plus icon to select a folder for backup. You can add multiple locations by selecting them one at a time.`" />
				</div>

				<!-- Selected Folders List -->
				<div v-if="selectedFolders.length > 0" class="space-y-2 border rounded-lg border-gray-500">
					<div v-for="(folder, index) in selectedFolders" :key="index" class="p-2">
						<div class="flex items-center m-[1rem]">
							<div class="flex items-center w-[25%] flex-shrink-0 space-x-2">
								<label class="text-default font-semibold text-left">{{ folder.name }}</label>
							</div>
							<input disabled :value="folder.path"
								class="bg-default h-[3rem] mr-[1rem] text-default rounded-lg px-4 flex-1 border border-default" />
							<!-- Wrapper for the buttons to keep them together -->
							<div class="flex space-x-2">
								<button @click="editSchedule(backUpSetupConfig!.backUpTasks[index].schedule)"
									class="btn btn-secondary h-10 w-fit flex flex-row justify-between px-3 text-center items-center">
									<CalendarIcon class="w-6 h-6 text-white-500" />
									<span class="text-sm px-2">Edit Schedule</span>
								</button>
								<button @click="removeFolder(index)" class="btn btn-secondary">
									<MinusIcon class="w-6 h-6 text-white-500"></MinusIcon>
								</button>
							</div>
						</div>
					</div>
				</div>


			</div>
		</div>
		<Modal :show="showCalendar" class="-mt-10"
			@clickOutside="">
			<div class="w-full max-w-xl mx-auto">
				<SimpleCalendar title="Schedule Your Backup" :taskSchedule="selectedTaskSchedule"
					@close="handleCalendarClose(false)" @save="handleCalendarClose(true)"
					class="border-2 border-default rounded-md w-full" />
			</div>
		</Modal>

		<!-- Buttons -->
		<template #footer>
			<div class="button-group-row justify-between">
				<button @click=" proceedToPreviousStep" class="btn btn-primary h-20 w-40">
					Back
				</button>
				<button :disabled="backUpSetupConfig?.backUpTasks.length === 0" @click="proceedToNextStep"
					class="absolute btn right-[1rem] btn-secondary h-20 w-40">
					Next
				</button>
			</div>
		</template>

	</CardContainer>
</template>

<script setup lang="ts">
import { CardContainer, CommanderToolTip, Modal } from "@45drives/houston-common-ui";
import { useWizardSteps, DynamicBrandingLogo } from '@45drives/houston-common-ui';
import { inject, ref, reactive, watch, nextTick } from "vue";
import { PlusIcon, MinusIcon } from "@heroicons/vue/20/solid";
import { backUpSetupConfigKey } from "../../keys/injection-keys";
import { CalendarIcon } from "@heroicons/vue/24/outline";
import { BackUpTask, IPCRouter, TaskSchedule } from "@45drives/houston-common-lib";
import { Server } from '../../types'
import { SimpleCalendar } from "../../components/calendar";
import { divisionCodeInjectionKey } from '../../keys/injection-keys';
import { sanitizeFilePath } from "./utils";
const division = inject(divisionCodeInjectionKey);
// Reactive State
const backUpSetupConfig = inject(backUpSetupConfigKey);

const selectedFolders = ref<{ name: string; path: string }[]>([]);
const scheduleFrequency = ref<"hour" | "day" | "week" | "month">("hour");

const servers = ref<Server[]>([]);
const selectedServer = ref<Server | null>(null);

const selectedTaskSchedule = ref<any>();

const { completeCurrentStep, prevStep } = useWizardSteps("backup");

const showCalendar = ref(false);
let resolveCalendarPromise: ((value: boolean) => void) | null = null;

async function onCalendarSave(newSchedule: TaskSchedule) {
	// overwrite the parent’s copy
	selectedTaskSchedule.value = reactive(newSchedule)
	handleCalendarClose(true)
}

function toggleCalendarComponent() {
	showCalendar.value = true;

	return new Promise<boolean>((resolve) => {
		resolveCalendarPromise = resolve;
	});
}

function handleCalendarClose(saved: boolean) {
	showCalendar.value = false;
	if (resolveCalendarPromise) {
		resolveCalendarPromise(saved);
		resolveCalendarPromise = null;
	}
}

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
	selectedServer.value = discoveredServers[0];
	
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


// Watch and Update Tasks When Schedule Changes
watch(scheduleFrequency, (newSchedule) => {
	if (backUpSetupConfig) {
		backUpSetupConfig.backUpTasks = backUpSetupConfig.backUpTasks.map((task) => {
			task.schedule.repeatFrequency = newSchedule;
			return task;
		});
	}
});


// Folder Selection
const handleFolderSelect = async () => {
	if (!window.electron?.selectFolder) {
		console.error("Electron API not available! Ensure preload script is loaded.");
		return;
	}

	try {
		const folderPath = await window.electron.selectFolder();
		if (!folderPath) return;

		const folderName = folderPath.split("/").pop() ?? "Unknown Folder";

		if (backUpSetupConfig) {

			// Prevent Duplicate Folder Selection (Case-Insensitive)
			if (!backUpSetupConfig?.backUpTasks.some(task => task.source.trim().toLowerCase() === folderPath.trim().toLowerCase())) {
				// Wait for the user to confirm schedule in CalendarConfig
				selectedTaskSchedule.value = reactive<TaskSchedule>({
					repeatFrequency: 'day',
					startDate: new Date()
				});

				console.log('schedule pre-calendar:', selectedTaskSchedule.value);

				const scheduleConfirmed = await toggleCalendarComponent();
				if (!scheduleConfirmed) {
					console.log("User cancelled scheduling, not adding task.");
					return;
				}

				console.log('schedule post-calendar:', selectedTaskSchedule.value);

				const newTask: BackUpTask = {
					schedule: selectedTaskSchedule.value,
					description: `Backup task for ${folderName}`,
					source: folderPath,
					target: `\\\\${selectedServer.value?.name}.local\\${selectedServer.value?.shareName}`,
					mirror: false,
				};

				console.log('newTask:', newTask);

				const newBackUpTasks = [...backUpSetupConfig?.backUpTasks];
				newBackUpTasks.push(newTask);
				backUpSetupConfig.backUpTasks = newBackUpTasks;
				selectedFolders.value.push({ name: folderName, path: folderPath });
			}
		}
	} catch (error) {
		console.error("Error selecting folder:", error);
	}
};

async function editSchedule(taskSchedule: TaskSchedule) {
	// Set the selected schedule for editing
	selectedTaskSchedule.value = reactive({
		repeatFrequency: taskSchedule.repeatFrequency,
		startDate: new Date(taskSchedule.startDate),
	});

	// Wait for Vue to update before showing the modal
	await nextTick();

	// Open the calendar modal
	const scheduleConfirmed = await toggleCalendarComponent();

	// If the user saves, update the task schedule
	if (scheduleConfirmed) {
		taskSchedule.repeatFrequency = selectedTaskSchedule.value.repeatFrequency;
		taskSchedule.startDate = selectedTaskSchedule.value.startDate;
	}
}

// Remove Folder from List
const removeFolder = (index: number) => {
	selectedFolders.value.splice(index, 1);
	if (backUpSetupConfig) {
		const newBackUpTasks = [...backUpSetupConfig?.backUpTasks];
		newBackUpTasks.splice(index, 1);
		backUpSetupConfig.backUpTasks = newBackUpTasks;
	}
};

let hostname = ""
IPCRouter.getInstance().addEventListener("action", (data) => {
	try {
		const jsondata = JSON.parse(data);

		if (jsondata.type === "sendHostname") {
			hostname = sanitizeFilePath(jsondata.hostname);
		} 
	} catch (_e) {}
})

IPCRouter.getInstance().send("backend", "action", "requestHostname");

// Navigation
const proceedToNextStep = () => {

	backUpSetupConfig?.backUpTasks.forEach(
		task => {
			task.target = `${selectedServer.value!.name}.local:${selectedServer.value!.shareName!}/${hostname}/${crypto.randomUUID()}${sanitizeFilePath(task.source)}`;
			console.log('target saved:', task.target);
		});

	completeCurrentStep();
}

// Proceed to Previous Step
const proceedToPreviousStep = () => {
	prevStep();
};

</script>
