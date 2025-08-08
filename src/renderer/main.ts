// import log from 'electron-log';
// log.transports.console.level = false;
// console.log = (...args) => log.info(...args);
// console.error = (...args) => log.error(...args);
// console.warn = (...args) => log.warn(...args);
// console.debug = (...args) => log.debug(...args);

// 1) keep a reference to the real console.error
const _origError = console.error.bind(console)

// 2) override console.error to filter out just that one warning…
console.error = (...args: any[]) => {
    // look for the TLS-warning substring and swallow it
    if (
        args.length > 0 &&
        typeof args[0] === 'string' &&
        args[0].includes('SETTING THE NODE_TLS_REJECT_UNAUTHORIZED')
    ) {
        return
    }
    // otherwise pass it through
    _origError(...args)
}

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
document.documentElement.classList.add('theme-homelab');

const IGNORE = [
    'setup() return property "_" should not start with "$" or "_"',
    'Extraneous non-props attributes'
]

app.config.warnHandler = (msg, instance, trace) => {
    // swallow any warning whose text matches one of the patterns
    if (IGNORE.some(p => msg.includes(p))) return

    // otherwise let it through
    console.warn(`[Vue warn]: ${msg}${trace}`)
}