<template>
	<CardContainer class="overflow-y-auto min-h-0">
		<template #header class="!text-center">
			<div class="relative flex items-center justify-center h-18  w-full">
				<div class="absolute left-0 p-1 px-4 rounded-lg">
					<DynamicBrandingLogo :division="division" />
				</div>
				<p class="text-3xl font-semibold text-center">
					Customize Backup Plan
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
						<div class="flex items-center">
							<div class="flex items-center w-[25%] flex-shrink-0 space-x-2">
								<label class="text-default font-semibold text-left">Back Up Location</label>
								<CommanderToolTip
									:message="`This is the designated backup storage location you set up earlier.`" />
							</div>
							<!-- <select v-model="selectedServer"
								class="bg-default h-[3rem] text-default rounded-lg px-4 flex-1 border border-default">
								<option v-for="item in servers" :key="item.ip" :value="item">
									{{ `\\\\${item.name}\\${item.shareName}` }}
								</option>
							</select> -->
							<select v-model="selectedServerIp"
								class="bg-default h-[3rem] text-default rounded-lg px-4 flex-1 border border-default">>
								<option v-for="item in servers" :key="item.ip" :value="item.ip">
									{{ `\\\\${item.name}\\${item.shareName}` }}
								</option>
							</select>

						</div>

						<!-- Folder Selection Button -->
						<div class="flex flex-row items-center mt-4">
							<button @click="handleFolderSelect" class="relative btn btn-secondary h-10 w-15">
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
								<!-- Wrapper for the buttons to keep them together -->
								<div class="flex space-x-2">
									<button @click="editSchedule(backUpSetupConfig!.backUpTasks[index].schedule)"
										class="btn btn-secondary h-10 w-fit flex flex-row justify-between px-3 text-center items-center">
										<CalendarIcon class="w-6 h-6 text-white" />
										<span class="text-sm px-2">Edit Schedule</span>
									</button>
									<button @click="removeFolder(index)" class="btn btn-secondary">
										<MinusIcon class="w-6 h-6 text-white"></MinusIcon>
									</button>
								</div>
							</div>
						</div>

					</div>
				</div>

			</div>
		</div>
		<Modal :show="showCalendar" class="-mt-10" @clickOutside="">
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
import { CardContainer, CommanderToolTip, Modal, useEnterToAdvance } from "@45drives/houston-common-ui";
import { useWizardSteps, DynamicBrandingLogo } from '@45drives/houston-common-ui';
import { inject, ref, reactive, watch, nextTick, computed } from "vue";
import { PlusIcon, MinusIcon } from "@heroicons/vue/20/solid";
import { backUpSetupConfigKey } from "../../keys/injection-keys";
import MessageDialog from '../../components/MessageDialog.vue';
import { CalendarIcon } from "@heroicons/vue/24/outline";
import { BackUpTask, IPCRouter, TaskSchedule } from "@45drives/houston-common-lib";
import { Server, DiscoveryState } from '../../types'
import { SimpleCalendar } from "../../components/calendar";
import { divisionCodeInjectionKey, discoveryStateInjectionKey } from '../../keys/injection-keys';
import { sanitizeFilePath } from "./utils";
import GlobalSetupWizardMenu from '../../components/GlobalSetupWizardMenu.vue';

const division = inject(divisionCodeInjectionKey);

// Reactive State
const backUpSetupConfig = inject(backUpSetupConfigKey);

const selectedFolders = ref<{ name: string; path: string }[]>([]);
const scheduleFrequency = ref<"hour" | "day" | "week" | "month">("hour");
const isSelectingFolder = ref(false);
const messageFolderAlreadyAdded = ref<InstanceType<typeof MessageDialog> | null>(null);
const messageSubFolderAlreadyAdded = ref<InstanceType<typeof MessageDialog> | null>(null);
const messageParentFolderAlreadyAdded = ref<InstanceType<typeof MessageDialog> | null>(null);

// const servers = ref<Server[]>([]);
const discoveryState = inject<DiscoveryState>(discoveryStateInjectionKey)!
// const servers = computed(() => discoveryState.servers)

const servers = computed(() =>
	discoveryState.servers.filter(server =>
		server.setupComplete === true &&
		server.status === 'complete'
	)
)

const selectedTaskSchedule = ref<any>();

const { completeCurrentStep, prevStep } = useWizardSteps("backup");

const showCalendar = ref(false);
let resolveCalendarPromise: ((value: boolean) => void) | null = null;

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

const selectedServerIp = ref('');

const selectedServer = computed(() =>
	servers.value.find(srv => srv.ip === selectedServerIp.value) ?? null
);

watch(servers, (discoveredServers) => {
	if (discoveredServers.length === 0) {
		selectedServerIp.value = '';
		return;
	}

	// Only set if nothing is selected
	if (!selectedServerIp.value) {
		const tasks = backUpSetupConfig?.backUpTasks;
		const target = tasks?.[0]?.target;
		const match = discoveredServers.find(srv => target?.includes(srv.ip));
		selectedServerIp.value = match?.ip ?? discoveredServers[0].ip;
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


// Folder Selection
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
			const existingFolders = backUpSetupConfig.backUpTasks.map(task =>
				normalizePath(task.source.trim())
			);

			// Prevent exact duplicates
			if (existingFolders.includes(normalizedFolderPath)) {
				messageFolderAlreadyAdded.value?.show();
				return;
			}

			// Prevent adding child folder of an existing one
			if (existingFolders.some(existingPath =>
				normalizedFolderPath.startsWith(existingPath + "/") || normalizedFolderPath.startsWith(existingPath + "\\")
			)) {
				messageParentFolderAlreadyAdded.value?.show();
				return;
			}

			// Prevent adding parent folder if subfolder already exists
			if (existingFolders.some(existingPath =>
				existingPath.startsWith(normalizedFolderPath + "/") || existingPath.startsWith(normalizedFolderPath + "\\")
			)) {
				messageSubFolderAlreadyAdded.value?.show();
				return;
			}

			// Ask user to confirm schedule via calendar
			selectedTaskSchedule.value = reactive<TaskSchedule>({
				repeatFrequency: 'day',
				startDate: new Date()
			});

			const scheduleConfirmed = await toggleCalendarComponent();
			if (!scheduleConfirmed) {
				// console.debug("User cancelled scheduling, not adding task.");
				return;
			}

			// Add new task
			const newTask: BackUpTask = {
				schedule: selectedTaskSchedule.value,
				description: `Backup task for ${folderName}`,
				source: folderPath,
				target: `\\\\${selectedServer.value?.name}\\${selectedServer.value?.shareName}`,
				mirror: false,
				uuid: crypto.randomUUID(),
			};

			// console.debug('New backup task:', newTask);

			backUpSetupConfig.backUpTasks.push(newTask);
			selectedFolders.value.push({ name: folderName, path: folderPath });

			if (!backUpSetupConfig.backUpTasks.length) {
				selectedFolders.value = [];
			}
		}
	} catch (error) {
		console.error("Error selecting folder:", error);
	} finally {
		isSelectingFolder.value = false;
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
		(task: BackUpTask) => {
			const targetDirForSourcePart = sanitizeFilePath(task.source);
			const slashOrNotSlash = targetDirForSourcePart.startsWith("/") ? "" : "/";

			task.target = `${selectedServer.value!.name}:${selectedServer.value!.shareName!}/${task.uuid}/${hostname}${slashOrNotSlash}${targetDirForSourcePart}`;
			// console.debug('target saved:', task.target);
		});

	completeCurrentStep();
}

// Proceed to Previous Step
const proceedToPreviousStep = () => {
	prevStep();
};

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
