import { createRouter, createWebHashHistory } from 'vue-router';
import Overview from './views/Overview.vue';
import CityTrend from './views/CityTrend.vue';
import Community from './views/Community.vue';
import DataAdmin from './views/DataAdmin.vue';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: Overview },
    { path: '/city', component: CityTrend },
    { path: '/community', component: Community },
    { path: '/data', component: DataAdmin },
  ],
});
