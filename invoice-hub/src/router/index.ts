import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true },
    },
    {
      path: '/',
      name: 'dashboard',
      component: () => import('@/views/DashboardView.vue'),
    },
    {
      path: '/invoices',
      name: 'invoices',
      component: () => import('@/views/invoices/InvoiceListView.vue'),
    },
    {
      path: '/invoices/new',
      name: 'invoices-new',
      component: () => import('@/views/invoices/InvoiceUploadView.vue'),
    },
    {
      path: '/invoices/:id',
      name: 'invoices-show',
      component: () => import('@/views/invoices/InvoiceDetailView.vue'),
    },
    {
      path: '/purchase-requests',
      name: 'purchase-requests',
      component: () => import('@/views/purchase-requests/PurchaseRequestListView.vue'),
    },
    {
      path: '/purchase-requests/new',
      name: 'purchase-requests-new',
      component: () => import('@/views/purchase-requests/PurchaseRequestFormView.vue'),
    },
    {
      path: '/vendors',
      name: 'vendors',
      component: () => import('@/views/vendors/VendorListView.vue'),
    },
    {
      path: '/item-masters',
      name: 'item-masters',
      component: () => import('@/views/item-masters/ItemMasterListView.vue'),
    },
  ],
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (!to.meta.public && !auth.isLoggedIn()) {
    return { name: 'login' }
  }
})

export default router
