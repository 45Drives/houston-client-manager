<template>
    <CockpitWebview routePath="/super-simple-setup-test" heightClass="h-[100vh]" wrapperClass="h-[100vh]"
        :openDevtoolsInDev="true" />
</template>

<script setup lang="ts">
import CockpitWebview from '../components/CockpitWebview.vue'
</script>
