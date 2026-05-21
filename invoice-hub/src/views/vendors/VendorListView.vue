<template>
  <AppLayout>
    <div class="page-header">
      <h2>仕入先マスター</h2>
      <button class="btn-primary" @click="showForm = true">+ 仕入先を追加</button>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>社名</th><th>住所</th><th>インボイス登録番号</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-if="vendors.length === 0">
            <td colspan="4" class="empty">仕入先がありません</td>
          </tr>
          <tr v-for="v in vendors" :key="v.id">
            <td>{{ v.name }}</td>
            <td>{{ v.address ?? '-' }}</td>
            <td>{{ v.invoice_registration_number ?? '-' }}</td>
            <td><button class="btn-sm" @click="remove(v.id)">削除</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 追加フォーム -->
    <div v-if="showForm" class="modal-overlay" @click.self="showForm = false">
      <div class="modal">
        <h3>仕入先を追加</h3>
        <div class="field">
          <label>社名 <span class="required">*</span></label>
          <input v-model="form.name" type="text" />
        </div>
        <div class="field">
          <label>住所</label>
          <input v-model="form.address" type="text" />
        </div>
        <div class="field">
          <label>インボイス登録番号</label>
          <input v-model="form.invoice_registration_number" type="text" placeholder="T1234567890123" />
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" @click="showForm = false">キャンセル</button>
          <button class="btn-primary" @click="save">保存</button>
        </div>
      </div>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import AppLayout from '@/components/common/AppLayout.vue'
import { vendorsApi } from '@/api/vendors'

const vendors = ref<any[]>([])
const showForm = ref(false)
const form = ref({ name: '', address: '', invoice_registration_number: '' })

const load = async () => {
  const res = await vendorsApi.list()
  vendors.value = res.data
}

const save = async () => {
  if (!form.value.name) return
  await vendorsApi.create(form.value)
  form.value = { name: '', address: '', invoice_registration_number: '' }
  showForm.value = false
  await load()
}

const remove = async (id: number) => {
  if (!confirm('削除しますか？')) return
  await vendorsApi.destroy(id)
  await load()
}

onMounted(load)
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.2rem; }
.btn-primary { background: #2563eb; color: #fff; padding: .5rem 1.2rem; border-radius: 6px; border: none; cursor: pointer; font-size: .9rem; }
.table-wrap { background: #fff; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.08); overflow: hidden; }
table { width: 100%; border-collapse: collapse; }
th { background: #f1f5f9; padding: .7rem 1rem; text-align: left; font-size: .82rem; color: #64748b; }
td { padding: .75rem 1rem; border-top: 1px solid #f1f5f9; font-size: .9rem; }
.empty { text-align: center; color: #94a3b8; padding: 2rem; }
.btn-sm { padding: .3rem .8rem; background: #fee2e2; color: #991b1b; border: none; border-radius: 4px; cursor: pointer; font-size: .8rem; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: #fff; border-radius: 8px; padding: 1.8rem; width: 440px; }
h3 { margin: 0 0 1.2rem; }
.field { margin-bottom: 1rem; }
label { display: block; font-size: .85rem; color: #374151; margin-bottom: .3rem; }
.required { color: #dc2626; }
input { width: 100%; padding: .55rem .8rem; border: 1px solid #ddd; border-radius: 6px; font-size: .9rem; box-sizing: border-box; }
.modal-actions { display: flex; gap: .8rem; justify-content: flex-end; margin-top: 1.2rem; }
.btn-secondary { padding: .5rem 1.2rem; background: #f1f5f9; color: #374151; border: 1px solid #ddd; border-radius: 6px; cursor: pointer; }
</style>
