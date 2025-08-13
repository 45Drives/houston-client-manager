import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: () => import('../renderer/views/DashboardView.vue') },
    { path: '/setup', name: 'setup', component: () => import('../renderer/views/SetupWizardView.vue') },
    { path: '/backup', name: 'backup', component: () => import('../renderer/views/BackupWizardView.vue') },
    { path: '/restore', name: 'restore', component: () => import('../renderer/views/RestoreWizardView.vue') },
    {
      path: '/houston',
      name: 'houston',
      component: () => import('../renderer/views/HoustonWebView.vue'),
      meta: { hideHeader: true, title: '' }
    },
    { path: '/backup/new', name: 'create new backup', component: () => import('../renderer/views/backupSetupWizard/NewBackupWizard.vue')}
  ],
})
