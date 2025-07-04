import { createApp } from 'vue';
import "@45drives/houston-common-css/src/index.css"; 
import "@45drives/houston-common-ui/style.css"; 
import "./style.css"; 
import App from './App.vue';
import { enterNextDirective } from '@45drives/houston-common-ui'

const app = createApp(App);
app.directive('enter-next', enterNextDirective);
app.mount('#app');
document.documentElement.classList.add('theme-default');
