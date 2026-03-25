<template>
	<CardContainer class="overflow-y-auto min-h-0">
		<div class="flex flex-col max-h-[calc(100vh-12rem)] min-h-0 flex-1 overflow-hidden">
			<div class="flex flex-col h-full min-h-0">
				<div class="flex flex-col flex-1 min-h-0 overflow-hidden w-full sm:w-9/12 mx-auto px-2 sm:px-0 text-left space-y-2">
					<div class="text-center shrink-0">
						<p class="mb-2 text-xl">
							Choose the folders you want to back up, pick a schedule, and we'll handle the rest.
						</p>
						<p class="mb-2 text-sm text-muted">
							File explorer may open on a different screen when you click the add button.
						</p>
					</div>

					<div class="shrink-0 space-y-2 overflow-hidden w-full">
						<!-- Backup Location -->
						<div class="flex items-center">
							<div class="flex items-center w-[25%] flex-shrink-0 space-x-2">
								<label class="text-default font-semibold text-left">Back Up Location</label>
								<CommanderToolTip
									:message="`This is the designated backup storage location you set up earlier (Either manually or via Setup Wizard).`" />
							</div>
							<div class="flex items-center flex-1 gap-2">
								<select v-model="selectedServerIp"
									class="bg-default h-[3rem] text-default rounded-lg px-4 flex-1 border border-default"
									:disabled="discoveryState.loading && servers.length === 0">
									<option v-if="discoveryState.loading && servers.length === 0" value="" disabled>
										Discovering servers…
									</option>
									<option v-for="item in servers" :key="item.ip" :value="item.ip">
										{{ `\\\\${item.name}\\${item.shareName}` }}
									</option>
								</select>
								<div v-if="discoveryState.loading" class="spinner-sm shrink-0" title="Discovering servers…"></div>
								<button v-else @click="rescan"
									class="w-8 h-8 p-0 rounded-md bg-transparent inline-flex items-center justify-center text-gray-500 hover:text-default hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
									title="Re-discover servers">
									<ArrowPathIcon class="w-4 h-4" />
								</button>
							</div>
						</div>

						<!-- Schedule Mode Toggle -->
						<div class="shrink-0 flex flex-row items-center py-2">
							<label class="w-[25%] text-default font-semibold text-start">Schedule Type</label>
							<div class="inline-flex rounded-lg border border-default overflow-hidden">
								<button
									class="px-4 py-2 text-sm font-medium transition-colors"
									:class="scheduleMode === 'interval' ? 'bg-primary text-primary-foreground' : 'bg-well hover:bg-accent text-default'"
									@click="scheduleMode = 'interval'">
									Simple
								</button>
								<button
									class="px-4 py-2 text-sm font-medium border-l border-default transition-colors"
									:class="scheduleMode === 'custom' ? 'bg-primary text-primary-foreground' : 'bg-well hover:bg-accent text-default'"
									@click="scheduleMode = 'custom'">
									Custom
								</button>
							</div>
						</div>

						<!-- Backup Interval (simple mode) -->
						<div v-if="scheduleMode === 'interval'" class="shrink-0 flex flex-row items-center py-2">
							<label class="w-[25%] text-default font-semibold text-start" :class="scheduleFrequency == 'hour' ? 'mb-5' : ''">
								Backup Interval
								<span v-if="scheduleFrequency !== 'hour'" class="font-normal text-muted text-sm block">
									Starts at 12:00 AM (Midnight)
								</span>
							</label>
							<select v-model="scheduleFrequency"
								class="bg-default h-[3rem] text-default rounded-lg px-4 flex-1 border border-default">
								<option value="hour">Hourly</option>
								<option value="day">Daily</option>
								<option value="week">Weekly</option>
								<option value="month">Monthly</option>
							</select>
						</div>

						<!-- Custom Schedule info -->
						<div v-if="scheduleMode === 'custom'" class="shrink-0 py-2">
							<p class="text-sm text-muted">
								Each folder will have its own schedule. Use the
								<CalendarIcon class="w-4 h-4 inline" /> button next to a folder to set its schedule.
							</p>
						</div>

						<!-- Folder Selection Button -->
						<div class="flex flex-row items-center mt-4">
							<button @click="handleFolderSelect" class="btn btn-sm btn-secondary h-fit">
								<PlusIcon class="w-4 h-4" />
							</button>
							<p class="text-start ml-2 font-semibold text-lg">
								Select a folder to back up.
							</p>
							<CommanderToolTip class="ml-4"
								:message="`Click the plus icon to select a folder for backup. You can add multiple locations by selecting them one at a time.`" />
						</div>

						<!-- Selected Folders List -->
						<div v-if="backUpSetupConfig?.backUpTasks.length! > 0"
							class="overflow-y-auto max-h-[40vh] border border-default rounded-lg shadow-inner bg-well p-2 space-y-4">
							<div v-for="(folder, index) in selectedFolders" :key="folder.path"
								class="flex items-center p-2">
								<div class="w-[25%] flex-shrink-0 space-y-1">
									<input v-model="folder.name"
										class="bg-default h-[3rem] text-default rounded-lg px-3 w-full border border-default text-sm"
										placeholder="Backup name (optional)"
										@input="syncFolderName(index, folder.name)" />
								</div>
								<input disabled :value="folder.path"
									class="bg-default h-[3rem] mr-4 ml-2 text-default rounded-lg px-4 flex-1 border border-default" />
								<div class="flex space-x-2">
									<button v-if="scheduleMode === 'custom'"
										@click="editSchedule(backUpSetupConfig!.backUpTasks[index].schedule)"
										class="btn btn-sm btn-secondary h-fit btn-with-icon">
										<CalendarIcon class="w-4 h-4" />
										<span>Edit Schedule</span>
									</button>
									<button @click="removeFolder(index)" class="btn btn-sm btn-secondary h-fit">
										<MinusIcon class="w-4 h-4" />
									</button>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>

		<!-- Calendar Modal (custom mode) -->
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
				<button @click="proceedToPreviousStep" class="btn btn-secondary h-fit">
					Back
				</button>
				<button :disabled="backUpSetupConfig?.backUpTasks.length === 0" @click="proceedToNextStep"
					class="btn btn-primary h-fit">
					Next
				</button>
			</div>
		</template>

		<MessageDialog ref="messageFolderAlreadyAdded" message="This path is already added." />
		<MessageDialog ref="messageSubFolderAlreadyAdded"
			message="A subfolder of this folder is already added. Please remove it first." />
		<MessageDialog ref="messageParentFolderAlreadyAdded"
			message="A parent folder is already added. You cannot add a subfolder." />
	</CardContainer>
</template>

<script setup lang="ts">
import { CardContainer, CommanderToolTip, Modal, useEnterToAdvance } from "@45drives/houston-common-ui";
import { useWizardSteps } from '@45drives/houston-common-ui';
import { computed, inject, onMounted, reactive, ref, watch, nextTick } from "vue";
import { PlusIcon, MinusIcon } from "@heroicons/vue/20/solid";
import { ArrowPathIcon, CalendarIcon } from "@heroicons/vue/24/outline";
import { backUpSetupConfigKey, discoveryStateInjectionKey, discoveryRescanInjectionKey, closeWizardModalKey } from "../../keys/injection-keys";
import MessageDialog from '../../components/MessageDialog.vue';
import { BackUpTask, IPCRouter, TaskSchedule } from "@45drives/houston-common-lib";
import { DiscoveryState } from '../../types';
import { useRouter } from 'vue-router';
import { SimpleCalendar } from "../../components/calendar";
import { sanitizeFilePath } from "./utils";
import { useHeader } from '../../composables/useHeader';

useHeader('Create Backup Task');
const router = useRouter();

const { completeCurrentStep, prevStep } = useWizardSteps('backup-new');

const backUpSetupConfig = inject(backUpSetupConfigKey);
const closeWizardModal = inject(closeWizardModalKey, () => router.push({ name: 'backup-manage' }));

const selectedFolders = ref<{ name: string; path: string }[]>([]);
const scheduleMode = ref<'interval' | 'custom'>('interval');
const scheduleFrequency = ref<"hour" | "day" | "week" | "month">("hour");
const isSelectingFolder = ref(false);

const messageFolderAlreadyAdded = ref<InstanceType<typeof MessageDialog> | null>(null);
const messageSubFolderAlreadyAdded = ref<InstanceType<typeof MessageDialog> | null>(null);
const messageParentFolderAlreadyAdded = ref<InstanceType<typeof MessageDialog> | null>(null);

const discoveryState = inject<DiscoveryState>(discoveryStateInjectionKey)!;
const rescan = inject(discoveryRescanInjectionKey, () => {});

const servers = computed(() =>
	discoveryState.servers.filter(server =>
		server.setupComplete === true &&
		server.status === 'complete'
	)
);

const selectedServerIp = ref('');
const selectedServer = computed(() =>
	servers.value.find(srv => srv.ip === selectedServerIp.value) ?? null
);

// Calendar modal state (custom mode)
const selectedTaskSchedule = ref<any>();
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

// Auto-select server
watch(servers, (discoveredServers) => {
	if (discoveredServers.length === 0) {
		selectedServerIp.value = '';
		return;
	}
	if (!selectedServerIp.value) {
		const tasks = backUpSetupConfig?.backUpTasks;
		const target = tasks?.[0]?.target;
		const match = discoveredServers.find(srv => target?.includes(srv.ip));
		selectedServerIp.value = match?.ip ?? discoveredServers[0].ip;
	}
});

// Update all task schedules when interval frequency changes (simple mode)
watch(scheduleFrequency, (newSchedule) => {
	if (scheduleMode.value !== 'interval' || !backUpSetupConfig) return;
	backUpSetupConfig.backUpTasks = backUpSetupConfig.backUpTasks.map((task) => {
		task.schedule.repeatFrequency = newSchedule;
		task.schedule.startDate = getNextScheduleDate(newSchedule);
		return task;
	});
});

// Sync selectedFolders with backUpSetupConfig
const loadExistingFolders = () => {
	selectedFolders.value = (backUpSetupConfig?.backUpTasks ?? []).map(task => ({
		name: task.name || (task.source?.split("/").pop() ?? "Unknown Folder"),
		path: task.source
	}));
};
onMounted(loadExistingFolders);

const normalizePath = (path: string) =>
	path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

watch(
	() => backUpSetupConfig?.backUpTasks.length,
	(newLength, oldLength) => {
		if (newLength !== oldLength) {
			selectedFolders.value = (backUpSetupConfig?.backUpTasks || []).map(task => ({
				name: task.name || task.description,
				path: task.source
			}));
		}
	},
	{ immediate: true }
);

// Folder selection
const handleFolderSelect = async () => {
	if (isSelectingFolder.value) return;
	isSelectingFolder.value = true;

	if (!window.electron?.selectFolder) {
		console.error("Electron API not available! Ensure preload script is loaded.");
		isSelectingFolder.value = false;
		return;
	}

	try {
		const folderPath = await window.electron.selectFolder();
		if (!folderPath) return;

		const normalizedFolderPath = normalizePath(folderPath);
		// Use the original path (not lowercased) for the display name
		const folderName = folderPath.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() ?? "Unknown Folder";

		if (backUpSetupConfig?.backUpTasks) {
			const existingFolders = backUpSetupConfig.backUpTasks.map(task =>
				normalizePath(task.source.trim())
			);

			if (existingFolders.includes(normalizedFolderPath)) {
				messageFolderAlreadyAdded.value?.show();
				return;
			}

			if (existingFolders.some(existingPath =>
				normalizedFolderPath.startsWith(existingPath + "/") || normalizedFolderPath.startsWith(existingPath + "\\")
			)) {
				messageParentFolderAlreadyAdded.value?.show();
				return;
			}

			if (existingFolders.some(existingPath =>
				existingPath.startsWith(normalizedFolderPath + "/") || existingPath.startsWith(normalizedFolderPath + "\\")
			)) {
				messageSubFolderAlreadyAdded.value?.show();
				return;
			}

			let taskSchedule: TaskSchedule;

			if (scheduleMode.value === 'custom') {
				// Open calendar for custom schedule
				selectedTaskSchedule.value = reactive<TaskSchedule>({
					repeatFrequency: 'day',
					startDate: new Date()
				});
				const scheduleConfirmed = await toggleCalendarComponent();
				if (!scheduleConfirmed) return;
				taskSchedule = selectedTaskSchedule.value;
			} else {
				// Use the interval-based schedule
				taskSchedule = {
					startDate: getNextScheduleDate(scheduleFrequency.value),
					repeatFrequency: scheduleFrequency.value
				};
			}

			const newTask: BackUpTask = {
				schedule: taskSchedule,
				description: `Backup task for ${folderName}`,
				name: folderName,
				source: folderPath,
				target: `\\\\${selectedServer.value?.name}\\${selectedServer.value?.shareName}`,
				mirror: false,
				uuid: crypto.randomUUID(),
			};

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

// Sync folder name changes back to the backup task
function syncFolderName(index: number, newName: string) {
	if (backUpSetupConfig?.backUpTasks[index]) {
		backUpSetupConfig.backUpTasks[index].name = newName;
	}
}

// Edit schedule for a specific folder (custom mode)
async function editSchedule(taskSchedule: TaskSchedule) {
	selectedTaskSchedule.value = reactive({
		repeatFrequency: taskSchedule.repeatFrequency,
		startDate: new Date(taskSchedule.startDate),
	});

	await nextTick();

	const scheduleConfirmed = await toggleCalendarComponent();
	if (scheduleConfirmed) {
		taskSchedule.repeatFrequency = selectedTaskSchedule.value.repeatFrequency;
		taskSchedule.startDate = selectedTaskSchedule.value.startDate;
	}
}

// Remove folder
const removeFolder = (index: number) => {
	selectedFolders.value.splice(index, 1);
	if (backUpSetupConfig) {
		const newBackUpTasks = [...backUpSetupConfig.backUpTasks];
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
			if (now >= nextDate) nextDate.setDate(nextDate.getDate() + 1);
			break;
		case 'week':
			nextDate.setHours(0, 0, 0, 0);
			nextDate.setDate(now.getDate() + 7);
			break;
		case 'month':
			nextDate.setHours(0, 0, 0, 0);
			const currentDay = now.getDate();
			nextDate.setMonth(now.getMonth() + 1);
			if (nextDate.getDate() < currentDay) nextDate.setDate(1);
			break;
	}

	return nextDate;
}

let hostname = "";
IPCRouter.getInstance().addEventListener("action", (data) => {
	try {
		const jsondata = JSON.parse(data);
		if (jsondata.type === "sendHostname") {
			hostname = sanitizeFilePath(jsondata.hostname);
		}
	} catch (_e) {}
});
IPCRouter.getInstance().send("backend", "action", "requestHostname");

// Navigation
const proceedToNextStep = () => {
	// Store planType based on schedule mode for downstream steps
	if (backUpSetupConfig) {
		(backUpSetupConfig as any).planType = scheduleMode.value === 'interval' ? 'simple' : 'custom';
	}

	backUpSetupConfig?.backUpTasks.forEach((task: BackUpTask) => {
		const targetDirForSourcePart = sanitizeFilePath(task.source);
		const slashOrNotSlash = targetDirForSourcePart.startsWith("/") ? "" : "/";
		task.target = `${selectedServer.value!.name}:${selectedServer.value!.shareName!}/${task.uuid}/${hostname}${slashOrNotSlash}${targetDirForSourcePart}`;
	});

	completeCurrentStep();
};

const proceedToPreviousStep = () => closeWizardModal();
useEnterToAdvance(
	() => {
		if (backUpSetupConfig!.backUpTasks.length > 0) proceedToNextStep();
	},
	200,
	() => {
		if (backUpSetupConfig!.backUpTasks.length > 0) proceedToNextStep();
	},
	() => {
		proceedToPreviousStep();
	}
);
</script>

<style scoped>
.spinner-sm {
  border: 3px solid rgba(128, 128, 128, 0.2);
  border-left-color: currentColor;
  border-radius: 50%;
  width: 24px;
  height: 24px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
