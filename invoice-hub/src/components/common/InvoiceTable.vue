<template>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>ファイル名</th>
          <th>仕入先</th>
          <th>請求日</th>
          <th>支払期日</th>
          <th>金額</th>
          <th>ステータス</th>
          <th>購入申請</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="invoices.length === 0">
          <td colspan="8" class="empty">データがありません</td>
        </tr>
        <tr v-for="inv in invoices" :key="inv.id">
          <td>{{ inv.file_name ?? '-' }}</td>
          <td>{{ inv.vendor?.name ?? '-' }}</td>
          <td>{{ inv.invoice_date ?? '-' }}</td>
          <td :class="{ overdue: isOverdue(inv) }">{{ inv.due_date ?? '-' }}</td>
          <td>¥{{ inv.total_amount?.toLocaleString() ?? '-' }}</td>
          <td><StatusBadge :status="inv.status" /></td>
          <td>{{ inv.purchase_request?.title ?? '未紐づけ' }}</td>
          <td>
            <router-link :to="`/invoices/${inv.id}`" class="btn-link">詳細</router-link>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import StatusBadge from './StatusBadge.vue'

defineProps<{ invoices: any[] }>()

const isOverdue = (inv: any) => {
  if (!inv.due_date || inv.status === 'paid') return false
  return inv.due_date < new Date().toISOString().slice(0, 10)
}
</script>

<style scoped>
.table-wrap { background: #fff; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.08); overflow: hidden; }
table { width: 100%; border-collapse: collapse; }
th { background: #f1f5f9; padding: .7rem 1rem; text-align: left; font-size: .82rem; color: #64748b; }
td { padding: .75rem 1rem; border-top: 1px solid #f1f5f9; font-size: .9rem; }
.overdue { color: #dc2626; font-weight: 600; }
.empty { text-align: center; color: #94a3b8; padding: 2rem; }
.btn-link { color: #2563eb; text-decoration: none; font-size: .85rem; }
</style>
