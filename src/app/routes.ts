import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: () => import('../renderer/views/DashboardView.vue') },
    { path: '/setup', name: 'setup', component: () => import('../renderer/views/SetupWizardView.vue') },
    { path: '/setup/bulk', name: 'bulk-setup', component: () => import('../renderer/views/bulkSetup/BulkSetupView.vue') },
    { path: '/backup/manage', name: 'backup-manage', component: () => import('../renderer/views/BackupManageView.vue') },
    { path: '/connections', name: 'vault', component: () => import('../renderer/views/CredentialVaultView.vue') },
    { path: '/server/:id', name: 'server-manage', component: () => import('../renderer/views/ServerManageView.vue'), props: true },
    {
      path: '/houston',
      name: 'houston',
      component: () => import('../renderer/views/HoustonWebView.vue'),
      meta: { hideHeader: true, title: '' }
    },
    { path: '/backup/new', name: 'create-new-backup', redirect: { name: 'backup-manage' } },
    {
      path: '/backup/view',
      name: 'view-selected-backups',
      component: () => import('../renderer/views/backupSetupWizard/BackupBrowser.vue'),
      // expose ids[] prop from ?ids=uuid1,uuid2
      props: (route) => ({
        ids: typeof route.query.ids === 'string'
          ? route.query.ids.split(',').filter(Boolean)
          : []
      })
    }
  ],
})
