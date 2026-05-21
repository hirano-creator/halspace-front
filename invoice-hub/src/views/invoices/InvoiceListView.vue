<template>
  <AppLayout>
    <div class="page-header">
      <h2>請求書一覧</h2>
      <router-link to="/invoices/new" class="btn-primary">+ 請求書を登録</router-link>
    </div>

    <div class="filters">
      <select v-model="filters.status" @change="() => load()">
        <option value="">すべてのステータス</option>
        <option value="unlinked">未紐づけ</option>
        <option value="pending">承認待ち</option>
        <option value="approved">承認済み</option>
        <option value="paid">支払済み</option>
        <option value="rejected">却下</option>
      </select>
      <input v-model="filters.from" type="date" @change="() => load()" placeholder="開始日" />
      <input v-model="filters.to" type="date" @change="() => load()" placeholder="終了日" />
    </div>

    <InvoiceTable :invoices="invoices" />

    <div class="pagination" v-if="meta.last_page > 1">
      <button :disabled="meta.current_page === 1" @click="changePage(meta.current_page - 1)">前へ</button>
      <span>{{ meta.current_page }} / {{ meta.last_page }}</span>
      <button :disabled="meta.current_page === meta.last_page" @click="changePage(meta.current_page + 1)">次へ</button>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import AppLayout from '@/components/common/AppLayout.vue'
import InvoiceTable from '@/components/common/InvoiceTable.vue'
import { invoicesApi } from '@/api/invoices'

const invoices = ref([])
const meta = ref({ current_page: 1, last_page: 1 })
const filters = ref({ status: '', from: '', to: '' })

const load = async (page = 1) => {
  const params: Record<string, string> = { page: String(page) }
  if (filters.value.status) params.status = filters.value.status
  if (filters.value.from) params.from = filters.value.from
  if (filters.value.to) params.to = filters.value.to
  const res = await invoicesApi.list(params)
  invoices.value = res.data.data
  meta.value = res.data.meta ?? res.data
}

const changePage = (page: number) => load(page)

onMounted(() => load())
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.2rem; }
.btn-primary { background: #2563eb; color: #fff; padding: .5rem 1.2rem; border-radius: 6px; text-decoration: none; font-size: .9rem; }
.filters { display: flex; gap: .8rem; margin-bottom: 1rem; }
.filters select, .filters input { padding: .5rem .8rem; border: 1px solid #ddd; border-radius: 6px; font-size: .9rem; }
.pagination { display: flex; align-items: center; gap: 1rem; justify-content: center; margin-top: 1.2rem; }
.pagination button { padding: .4rem 1rem; border: 1px solid #ddd; border-radius: 6px; cursor: pointer; }
.pagination button:disabled { opacity: .4; cursor: not-allowed; }
</style>
