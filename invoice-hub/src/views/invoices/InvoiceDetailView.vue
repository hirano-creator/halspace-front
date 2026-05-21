<template>
  <AppLayout>
    <div v-if="invoice" class="detail">
      <div class="page-header">
        <div>
          <h2>{{ invoice.file_name ?? '請求書詳細' }}</h2>
          <StatusBadge :status="invoice.status" />
        </div>
        <router-link to="/invoices" class="btn-back">← 一覧に戻る</router-link>
      </div>

      <div class="grid">
        <!-- 基本情報 -->
        <div class="card">
          <h3>基本情報</h3>
          <dl>
            <dt>仕入先</dt><dd>{{ invoice.vendor?.name ?? '未設定' }}</dd>
            <dt>請求書番号</dt><dd>{{ invoice.invoice_number ?? '-' }}</dd>
            <dt>請求日</dt><dd>{{ invoice.invoice_date ?? '-' }}</dd>
            <dt>支払期日</dt><dd :class="{ overdue: isOverdue }">{{ invoice.due_date ?? '-' }}</dd>
            <dt>合計金額</dt><dd class="amount">¥{{ invoice.total_amount?.toLocaleString() }}</dd>
            <dt>消費税</dt><dd>¥{{ invoice.tax_amount?.toLocaleString() }}</dd>
          </dl>
        </div>

        <!-- 購入申請紐づけ -->
        <div class="card">
          <h3>購入申請</h3>
          <div v-if="invoice.purchase_request">
            <p><strong>{{ invoice.purchase_request.title }}</strong></p>
            <p class="sub">申請者: {{ invoice.purchase_request.requester?.name }}</p>
            <p class="sub">用途: {{ invoice.purchase_request.purpose }}</p>
          </div>
          <div v-else>
            <p class="warn">未紐づけです</p>
            <select v-model="selectedPrId">
              <option value="">購入申請を選択...</option>
              <option v-for="pr in purchaseRequests" :key="pr.id" :value="pr.id">
                {{ pr.order_number }} - {{ pr.title }}
              </option>
            </select>
            <button class="btn-sm" :disabled="!selectedPrId" @click="linkPr">紐づける</button>
          </div>
        </div>

        <!-- 明細 -->
        <div class="card full">
          <h3>明細</h3>
          <table v-if="invoice.items?.length">
            <thead><tr><th>品目</th><th>数量</th><th>単価</th><th>金額</th><th>税率</th></tr></thead>
            <tbody>
              <tr v-for="item in invoice.items" :key="item.id">
                <td>{{ item.item_name }}</td>
                <td>{{ item.quantity }}</td>
                <td>¥{{ item.unit_price?.toLocaleString() }}</td>
                <td>¥{{ item.amount?.toLocaleString() }}</td>
                <td>{{ item.tax_rate }}%</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="sub">明細なし</p>
        </div>

        <!-- 承認アクション -->
        <div class="card full" v-if="invoice.status === 'pending'">
          <h3>承認</h3>
          <textarea v-model="approvalComment" placeholder="コメント（任意）" rows="3"></textarea>
          <div class="action-buttons">
            <button class="btn-approve" @click="doApprove('approve')">承認する</button>
            <button class="btn-reject" @click="doApprove('reject')">却下する</button>
          </div>
        </div>

        <!-- 承認ログ -->
        <div class="card full" v-if="invoice.approvals?.length">
          <h3>承認ログ</h3>
          <div v-for="log in invoice.approvals" :key="log.id" class="log-item">
            <span class="log-action" :class="log.action">{{ actionLabel(log.action) }}</span>
            <span class="log-by">{{ log.approver?.name }}</span>
            <span class="log-date">{{ log.created_at?.slice(0, 10) }}</span>
            <p v-if="log.comment" class="log-comment">{{ log.comment }}</p>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="loading">読み込み中...</div>
  </AppLayout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import AppLayout from '@/components/common/AppLayout.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import { invoicesApi } from '@/api/invoices'
import { purchaseRequestsApi } from '@/api/purchaseRequests'

const route = useRoute()
const invoice = ref<any>(null)
const purchaseRequests = ref<any[]>([])
const selectedPrId = ref('')
const approvalComment = ref('')

const isOverdue = computed(() => {
  if (!invoice.value?.due_date || invoice.value.status === 'paid') return false
  return invoice.value.due_date < new Date().toISOString().slice(0, 10)
})

const load = async () => {
  const res = await invoicesApi.get(Number(route.params.id))
  invoice.value = res.data
  if (!invoice.value.purchase_request) {
    const prRes = await purchaseRequestsApi.list({ status: 'approved' })
    purchaseRequests.value = prRes.data.data
  }
}

const linkPr = async () => {
  await invoicesApi.link(invoice.value.id, Number(selectedPrId.value))
  await load()
}

const doApprove = async (action: 'approve' | 'reject') => {
  await invoicesApi.approve(invoice.value.id, action, approvalComment.value)
  approvalComment.value = ''
  await load()
}

const actionLabel = (a: string) => ({ approve: '承認', reject: '却下', comment: 'コメント' }[a] ?? a)

onMounted(load)
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem; }
.btn-back { color: #64748b; text-decoration: none; font-size: .9rem; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
.card { background: #fff; border-radius: 8px; padding: 1.2rem 1.5rem; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
.card.full { grid-column: 1 / -1; }
h3 { margin: 0 0 .8rem; font-size: 1rem; color: #334155; }
dl { display: grid; grid-template-columns: 120px 1fr; gap: .4rem .8rem; font-size: .9rem; }
dt { color: #64748b; }
dd { margin: 0; }
.amount { font-size: 1.1rem; font-weight: 700; color: #1e293b; }
.overdue { color: #dc2626; font-weight: 600; }
.warn { color: #f59e0b; font-size: .9rem; margin-bottom: .8rem; }
.sub { color: #64748b; font-size: .85rem; }
select { width: 100%; padding: .5rem; border: 1px solid #ddd; border-radius: 6px; margin-bottom: .6rem; }
.btn-sm { padding: .4rem 1rem; background: #2563eb; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: .85rem; }
.btn-sm:disabled { opacity: .5; }
table { width: 100%; border-collapse: collapse; font-size: .9rem; }
th { background: #f1f5f9; padding: .5rem .8rem; text-align: left; font-size: .82rem; color: #64748b; }
td { padding: .6rem .8rem; border-top: 1px solid #f1f5f9; }
textarea { width: 100%; padding: .6rem; border: 1px solid #ddd; border-radius: 6px; resize: vertical; margin-bottom: .8rem; font-size: .9rem; box-sizing: border-box; }
.action-buttons { display: flex; gap: .8rem; }
.btn-approve { padding: .5rem 1.5rem; background: #16a34a; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
.btn-reject { padding: .5rem 1.5rem; background: #dc2626; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
.log-item { padding: .6rem 0; border-top: 1px solid #f1f5f9; display: flex; align-items: center; gap: .8rem; flex-wrap: wrap; }
.log-action { padding: .2rem .6rem; border-radius: 4px; font-size: .78rem; font-weight: 600; }
.log-action.approve { background: #dcfce7; color: #166534; }
.log-action.reject { background: #fee2e2; color: #991b1b; }
.log-action.comment { background: #f1f5f9; color: #475569; }
.log-by { font-weight: 500; font-size: .9rem; }
.log-date { color: #94a3b8; font-size: .82rem; }
.log-comment { width: 100%; margin: .3rem 0 0; font-size: .85rem; color: #475569; }
.loading { text-align: center; padding: 3rem; color: #94a3b8; }
</style>
