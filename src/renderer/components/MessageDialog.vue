<template>
  <div v-if="visible" class="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50">
    <div class="bg-default p-6 rounded-lg shadow-lg w-96">
      <p class="text-lg text-default">{{ message }}</p>
      <button @click="close" class="btn btn-secondary">
        Close
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps({
  message: String,
});

const visible = ref(false);

const show = () => {
  visible.value = true;
};

const close = () => {
  visible.value = false;
};

defineExpose({ show });
</script>
