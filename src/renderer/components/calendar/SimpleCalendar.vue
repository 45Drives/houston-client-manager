<template>
    <CardContainer class="justify-self-center">
        <template #header>
            <div class="flex flex-row text-center justify-center">
                {{ title }}
            </div>
        </template>

        <div class="grid grid-cols-1 gap-2">
            <div class="border border-default rounded-md p-2 w-full mx-auto">
                <label for="frequency-select" class="block text-sm font-medium">Backup Frequency</label>
                <select id="frequency-select" v-model="schedule.repeatFrequency" class="input-textlike w-full">
                    <option value="hour">Hourly</option>
                    <option value="day">Daily</option>
                    <option value="week">Weekly</option>
                    <option value="month">Monthly</option>
                </select>

                <div class="col-span-1 grid grid-cols-2 gap-1 mt-2">
                    <!-- Day Input -->
                    <div>
                        <label class="block text-sm">Start Day</label>
                        <input type="number" v-model="dayValue" @input="updateStartDate" min="1" max="31"
                            :disabled="schedule.repeatFrequency === 'hour'" class="input-textlike w-full"
                            placeholder="Day" />
                    </div>
                    <!-- Month Input -->
                    <div>
                        <label class="block text-sm">Start Month</label>
                        <input type="number" v-model="monthValue" @input="updateStartDate" min="1" max="12"
                            :disabled="schedule.repeatFrequency === 'hour'" class="input-textlike w-full"
                            placeholder="Month" />
                    </div>

                    <!-- Hour Input -->
                    <div>
                        <label class="block text-sm">Start Hour</label>
                        <input type="number" v-model="hourValue" @input="updateStartDate" min="0" max="23"
                            class="input-textlike w-full" placeholder="Hour" />
                    </div>
                    <!-- Minute Input -->
                    <div>
                        <label class="block text-sm">Start Minute</label>
                        <input type="number" v-model="minuteValue" @input="updateStartDate" min="0" max="59"
                            :disabled="schedule.repeatFrequency === 'hour'" class="input-textlike w-full"
                            placeholder="Minute" />
                    </div>
                </div>
            </div>

            <div :title="parsedIntervalString"
                class="col-span-1 mt-2 text-base text-default bg-well p-2 rounded-md text-center w-full max-w-[600px] mx-auto">
                <p class="mt-1 text-sm text-default">Start date/time: {{ schedule.startDate.toLocaleString() }}</p>

                <p><strong>Will run backup {{ parsedIntervalString }}.</strong> </p>
            </div>

            <div class="border border-default rounded-md p-2 ">
                <div class="text-center">
                    <div class="flex justify-between w-full mb-4">
                        <button @click="changeMonth(-1)" class="btn btn-secondary">
                            Prev
                        </button>
                        <span class="text-lg font-semibold text-default mt-2">{{ monthNames[currentMonth] }} {{
                            currentYear
                            }}</span>
                        <button @click="changeMonth(1)" class="btn btn-secondary">
                            Next
                        </button>
                    </div>
                    <div class="grid grid-cols-7 w-full mb-2">
                        <div v-for="day in weekDays" :key="day" class="text-center text-default font-medium">
                            {{ day }}
                        </div>
                    </div>
                    <div class="grid grid-cols-7 gap-1 w-full grid-rows-6 auto-rows-fr">
                        <!-- <div v-for="day in days" :key="day.id"
                            :class="{ 'bg-accent text-muted border-default': day.isPadding, 'bg-green-600 dark:bg-green-800': day.isMarked && !day.isPadding, 'bg-default': !day.isMarked && !day.isPadding }"
                            class="p-2 text-default text-center border border-default rounded">
                            {{ day.date }}
                        </div> -->
                        <div v-for="day in days" :key="day.id"
                            :class="[ day.isPadding ? 'bg-accent text-muted cursor-default' : 'cursor-pointer hover:bg-gray-700',
                            day.isMarked && !day.isPadding ? 'bg-green-600 dark:bg-green-800 text-white' : 'bg-default' ]"
                            class="p-2 text-default text-center border border-default rounded"
                            @click="!day.isPadding && selectDay(Number(day.date))">
                            {{ day.date }}
                        </div>
                        </div>
                    </div>
                </div>
            </div>

            <template #footer>
                <div class="button-group-row w-full justify-between">
                    <button @click.stop="emit('close')" class="btn btn-danger">Close</button>
                    <button :disabled="savingSchedule" @click="saveScheduleBtn()" class="btn btn-primary">
                        {{ savingSchedule ? 'Saving...' : 'Save Schedule' }}
                    </button>
                </div>
            </template>
    </CardContainer>
</template>

<script setup lang="ts">
import { ref, computed, watch, toRef } from 'vue';
import { CardContainer } from '@45drives/houston-common-ui';
import { CommanderToolTip } from '../commander';
import { type TaskSchedule, parseTaskScheduleIntoString } from "@45drives/houston-common-lib";

interface Props {
    title: string;
    taskSchedule: TaskSchedule;
}
const props = defineProps<Props>();
const emit = defineEmits(['close', 'save']);

const savingSchedule = ref(false);

// const schedule = ref<TaskSchedule>(props.taskSchedule || { repeatFrequency: 'day', startDate: new Date()});
// const schedule = ref<TaskSchedule>(
//     props.taskSchedule
//         ? { ...props.taskSchedule, startDate: new Date(props.taskSchedule.startDate) } // Ensure it's a Date object
//         : { repeatFrequency: 'day', startDate: new Date() } // Default when adding a new schedule
// );
const schedule = toRef(props, 'taskSchedule')

// Extract day/month values from startDate
const dayValue = ref(schedule.value.startDate.getDate());
const monthValue = ref(schedule.value.startDate.getMonth() + 1);
const hourValue = ref(schedule.value.startDate.getHours());
const minuteValue = ref(schedule.value.startDate.getMinutes());
const yearValue = ref(schedule.value.startDate.getFullYear());

/// Calendar logic
const today = new Date();
const currentMonth = ref(today.getMonth());
const currentYear = ref(today.getFullYear());

// Update startDate when inputs change
const updateStartDate = () => {
    schedule.value.startDate = new Date(
        yearValue.value,
        monthValue.value - 1,
        dayValue.value,
        hourValue.value,
        minuteValue.value
    );
};

function selectDay(d: number) {
    dayValue.value = d;
    monthValue.value = currentMonth.value + 1;
    yearValue.value = currentYear.value;
    updateStartDate();
}

watch(() => schedule.value.repeatFrequency, (newFrequency) => {
    if (newFrequency === 'hour') {
        minuteValue.value = 0;
        updateStartDate();
    }
});

// watch([minuteValue, hourValue, dayValue, monthValue], () => {
//     updateStartDate();
// });
watch([hourValue, minuteValue, dayValue, monthValue, yearValue], () => {
    if (hourValue.value != null && minuteValue.value != null) {
        updateStartDate();
    }
});

watch(
    () => props.taskSchedule.startDate,
    (newDate) => {
        dayValue.value = newDate.getDate();
        monthValue.value = newDate.getMonth() + 1;
        hourValue.value = newDate.getHours();
        minuteValue.value = newDate.getMinutes();
    },
    { immediate: true }
);


const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const days = computed(() => {
    const firstDayOfMonth = new Date(currentYear.value, currentMonth.value, 1).getDay();
    const numDays = new Date(currentYear.value, currentMonth.value + 1, 0).getDate();

    const daysArray = Array.from({ length: numDays }, (_, i) => {
        const date = new Date(currentYear.value, currentMonth.value, i + 1);
        const id = date.toISOString().split('T')[0];
        return { id, date: i + 1, isMarked: isScheduled(date), isPadding: false };
    });

    const startPaddingDays = Array.from({ length: firstDayOfMonth }, (_, i) => ({
        id: `pad-start-${i}`,
        date: '',
        isMarked: false,
        isPadding: true,
    }));

    const totalCells = 42;
    const endPaddingCount = totalCells - (startPaddingDays.length + daysArray.length);
    const endPaddingDays = Array.from({ length: endPaddingCount }, (_, i) => ({
        id: `pad-end-${i}`,
        date: '',
        isMarked: false,
        isPadding: true,
    }));

    return [...startPaddingDays, ...daysArray, ...endPaddingDays];
});

// Function to check if a date should be marked based on schedule
const isScheduled = (date: Date): boolean => {
    if (!schedule.value.startDate) return false;

    const startDate = new Date(schedule.value.startDate);
    startDate.setHours(0, 0, 0, 0); // Normalize to midnight
    date.setHours(0, 0, 0, 0); // Ensure uniform comparison

    if (date.getTime() === startDate.getTime()) return true; //  Always highlight the start date
    if (date < startDate) return false; //  Don't mark days before start date

    const freq = schedule.value.repeatFrequency;
    if (freq === 'hour' || freq === 'day') return date >= startDate;
    if (freq === 'week') return date >= startDate && date.getDay() === startDate.getDay();
    if (freq === 'month') return date >= startDate && date.getDate() === startDate.getDate();

    return false;
};



// Change month in calendar
const changeMonth = (delta: number) => {
    let m = currentMonth.value + delta;
    let y = currentYear.value;
    if (m < 0) { m = 11; y--; }
    else if (m > 11) { m = 0; y++; }
    currentMonth.value = m;
    currentYear.value = y;
    yearValue.value = y;
};


// Save function
async function saveScheduleBtn() {
    savingSchedule.value = true;
    updateStartDate();             
    emit('save', schedule.value);
}


const parsedIntervalString = computed(() => parseTaskScheduleIntoString(schedule.value));
</script>

<style scoped>
.grid-rows-6 {
    grid-template-rows: repeat(6, minmax(0, 1fr));
}
</style>
