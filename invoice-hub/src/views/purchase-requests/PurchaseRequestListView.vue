<template>
  <AppLayout>
    <div class="page-header">
      <h2>購入申請一覧</h2>
      <router-link to="/purchase-requests/new" class="btn-primary">+ 購入申請を作成</router-link>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>発注番号</th><th>件名</th><th>申請者</th><th>概算金額</th><th>ステータス</th><th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="items.length === 0">
            <td colspan="6" class="empty">申請がありません</td>
          </tr>
          <tr v-for="pr in items" :key="pr.id">
            <td>{{ pr.order_number ?? '-' }}</td>
            <td>{{ pr.title }}</td>
            <td>{{ pr.requester?.name ?? '-' }}</td>
            <td>¥{{ pr.estimated_amount?.toLocaleString() }}</td>
            <td><StatusBadge :status="pr.status" /></td>
            <td>
              <button v-if="pr.status === 'pending'" class="btn-sm approve" @click="approve(pr.id, 'approve')">承認</button>
              <button v-if="pr.status === 'pending'" class="btn-sm reject" @click="approve(pr.id, 'reject')">却下</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import AppLayout from '@/components/common/AppLayout.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import { purchaseRequestsApi } from '@/api/purchaseRequests'

const items = ref<any[]>([])

const load = async () => {
  const res = await purchaseRequestsApi.list()
  items.value = res.data.data
}

const approve = async (id: number, action: 'approve' | 'reject') => {
  await purchaseRequestsApi.approve(id, action)
  await load()
}

onMounted(load)
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.2rem; }
.btn-primary { background: #2563eb; color: #fff; padding: .5rem 1.2rem; border-radius: 6px; text-decoration: none; font-size: .9rem; }
.table-wrap { background: #fff; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.08); overflow: hidden; }
table { width: 100%; border-collapse: collapse; }
th { background: #f1f5f9; padding: .7rem 1rem; text-align: left; font-size: .82rem; color: #64748b; }
td { padding: .75rem 1rem; border-top: 1px solid #f1f5f9; font-size: .9rem; }
.empty { text-align: center; color: #94a3b8; padding: 2rem; }
.btn-sm { padding: .3rem .8rem; border: none; border-radius: 4px; cursor: pointer; font-size: .8rem; margin-right: .4rem; }
.btn-sm.approve { background: #dcfce7; color: #166534; }
.btn-sm.reject { background: #fee2e2; color: #991b1b; }
</style>
