<template>
  <AppLayout>
    <h2>ダッシュボード</h2>
    <div class="cards">
      <div class="card warn">
        <div class="num">{{ stats.unlinked }}</div>
        <div class="label">未紐づけ請求書</div>
      </div>
      <div class="card danger">
        <div class="num">{{ stats.overdue }}</div>
        <div class="label">支払期日超過</div>
      </div>
      <div class="card info">
        <div class="num">{{ stats.pendingApproval }}</div>
        <div class="label">承認待ち</div>
      </div>
      <div class="card success">
        <div class="num">¥{{ stats.thisMonthTotal.toLocaleString() }}</div>
        <div class="label">今月の支払予定</div>
      </div>
    </div>

    <div class="section">
      <div class="section-header">
        <h3>最近の請求書</h3>
        <router-link to="/invoices">すべて見る →</router-link>
      </div>
      <InvoiceTable :invoices="recentInvoices" />
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import AppLayout from '@/components/common/AppLayout.vue'
import InvoiceTable from '@/components/common/InvoiceTable.vue'
import { invoicesApi } from '@/api/invoices'

const stats = ref({ unlinked: 0, overdue: 0, pendingApproval: 0, thisMonthTotal: 0 })
const recentInvoices = ref([])

onMounted(async () => {
  const res = await invoicesApi.list({ per_page: '5' })
  recentInvoices.value = res.data.data

  const all = res.data.data
  stats.value.unlinked = all.filter((i: any) => i.status === 'unlinked').length
  stats.value.pendingApproval = all.filter((i: any) => i.status === 'pending').length
  const today = new Date().toISOString().slice(0, 10)
  stats.value.overdue = all.filter((i: any) => i.due_date && i.due_date < today && i.status !== 'paid').length
  stats.value.thisMonthTotal = all
    .filter((i: any) => i.status !== 'rejected')
    .reduce((s: number, i: any) => s + (i.total_amount ?? 0), 0)
})
</script>

<style scoped>
h2 { margin-bottom: 1.5rem; }
.cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 2rem; }
.card { background: #fff; border-radius: 8px; padding: 1.2rem 1.5rem; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
.num { font-size: 1.8rem; font-weight: 700; margin-bottom: .3rem; }
.label { font-size: .85rem; color: #666; }
.card.warn .num { color: #f59e0b; }
.card.danger .num { color: #dc2626; }
.card.info .num { color: #2563eb; }
.card.success .num { color: #16a34a; }
.section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: .8rem; }
.section-header a { font-size: .9rem; color: #2563eb; text-decoration: none; }
</style>
