<template>
  <AppLayout>
    <div class="page-header">
      <h2>購入申請を作成</h2>
      <router-link to="/purchase-requests" class="btn-back">← 一覧に戻る</router-link>
    </div>

    <div class="form-card">
      <div class="field">
        <label>件名 <span class="required">*</span></label>
        <input v-model="form.title" type="text" placeholder="例: デザインツール月額費用" />
      </div>
      <div class="field">
        <label>用途・目的 <span class="required">*</span></label>
        <textarea v-model="form.purpose" rows="4" placeholder="何のために購入するか、具体的に記入してください"></textarea>
      </div>
      <div class="field">
        <label>概算金額（円） <span class="required">*</span></label>
        <input v-model.number="form.estimated_amount" type="number" min="0" placeholder="例: 15000" />
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <div class="actions">
        <button class="btn-secondary" @click="submit('draft')">下書き保存</button>
        <button class="btn-primary" @click="submit('pending')">申請して承認依頼</button>
      </div>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import AppLayout from '@/components/common/AppLayout.vue'
import { purchaseRequestsApi } from '@/api/purchaseRequests'

const router = useRouter()
const form = ref({ title: '', purpose: '', estimated_amount: 0 })
const error = ref('')

const submit = async (mode: 'draft' | 'pending') => {
  if (!form.value.title || !form.value.purpose || !form.value.estimated_amount) {
    error.value = '件名・用途・金額は必須です'
    return
  }
  error.value = ''
  const data = { ...form.value, status: mode }
  if (mode === 'pending') Object.assign(data, { approver_id: null })
  await purchaseRequestsApi.create(data)
  router.push('/purchase-requests')
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
.btn-back { color: #64748b; text-decoration: none; font-size: .9rem; }
.form-card { background: #fff; border-radius: 8px; padding: 2rem; max-width: 600px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
.field { margin-bottom: 1.2rem; }
label { display: block; font-size: .85rem; color: #374151; margin-bottom: .4rem; font-weight: 500; }
.required { color: #dc2626; }
input, textarea { width: 100%; padding: .6rem .8rem; border: 1px solid #ddd; border-radius: 6px; font-size: .95rem; box-sizing: border-box; }
textarea { resize: vertical; }
.error { color: #dc2626; font-size: .85rem; margin-bottom: .8rem; }
.actions { display: flex; gap: .8rem; }
.btn-primary { padding: .6rem 1.5rem; background: #2563eb; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: .95rem; }
.btn-secondary { padding: .6rem 1.5rem; background: #f1f5f9; color: #374151; border: 1px solid #ddd; border-radius: 6px; cursor: pointer; font-size: .95rem; }
</style>
