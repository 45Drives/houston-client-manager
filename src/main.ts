// src/main.ts (Vue Renderer Process)

import { createApp } from 'vue';
import App from './App.vue';

// Mount Vue app to the div with id="app" (this is in index.html)
createApp(App).mount('#app');