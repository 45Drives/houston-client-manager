import log from 'electron-log';
log.transports.console.level = false;
console.log = (...args) => log.info(...args);
console.error = (...args) => log.error(...args);
console.warn = (...args) => log.warn(...args);
console.debug = (...args) => log.debug(...args);

import { createApp } from 'vue';
import "@45drives/houston-common-css/src/index.css"; 
import "@45drives/houston-common-ui/style.css"; 
import "./style.css"; 
import App from './App.vue';
import { enterNextDirective } from '@45drives/houston-common-ui'

document.title = `45Drives Setup & Backup Wizard v${__APP_VERSION__}`;

const app = createApp(App);
app.directive('enter-next', enterNextDirective);
app.mount('#app');
document.documentElement.classList.add('theme-default');
