<script setup lang="ts">
import { defineProps } from "vue";

defineProps<{
	noBodyPaddingOnMobile?: boolean;
}>();
</script>

<template>
	<div class="bg-default md:shadow-lg shadow-md divide-y divide-default flex flex-col">
		<div v-if="$slots.header" class="px-4 py-2 sm:px-6 sm:py-5 text-header">
			<slot name="header"></slot>
		</div>
		<div class="flex-grow sm:px-6 sm:py-5" :class="{'px-4 py-5': !noBodyPaddingOnMobile}">
			<slot></slot>
		</div>
		<div v-if="$slots.footer" class="px-4 py-2 sm:px-6 sm:py-5">
			<slot name="footer"></slot>
		</div>
	</div>
</template>

<style scoped>
</style>
