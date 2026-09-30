import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import './style.css';

window.__errs = [];
window.addEventListener('error', (e) => window.__errs.push('[error] ' + e.message + ' STACK: ' + String(e.error && e.error.stack ? e.error.stack.split('\n').slice(0, 6).join(' ||| ') : '')));
window.addEventListener('unhandledrejection', (e) => window.__errs.push('[rejection] ' + String(e.reason && e.reason.stack ? e.reason.stack.split('\n').slice(0, 3).join(' | ') : e.reason)));
const _ce = console.error.bind(console);
console.error = (...a) => { window.__errs.push('[console.error] ' + a.map((x) => String(x && x.stack ? x.stack.split('\n').slice(0, 3).join(' | ') : x)).join(' ').slice(0, 500)); _ce(...a); };

createApp(App).use(router).mount('#app');
