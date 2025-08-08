// 1) capture originals
const _origWarn = console.warn.bind(console)
const _origError = console.error.bind(console)

// 2) override warn & error
console.warn = (...args: any[]) => {
    const msg = args.map(String).join(' ')
    if (
        msg.includes('APPIMAGE env is not defined') ||
        msg.includes('NODE_TLS_REJECT_UNAUTHORIZED')
    ) return
    _origWarn(...args)
}

console.error = (...args: any[]) => {
    const msg = args.map(String).join(' ')
    if (msg.includes('NODE_TLS_REJECT_UNAUTHORIZED')) return
    _origError(...args)
}

// import log from 'electron-log';
// log.transports.console.level = false;
// console.log = (...args) => log.info(...args);
// console.error = (...args) => log.error(...args);
// console.warn = (...args) => log.warn(...args);
// console.debug = (...args) => log.debug(...args);

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