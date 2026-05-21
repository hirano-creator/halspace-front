<template>
  <AppLayout>
    <div class="page-header">
      <h2>品目マスター</h2>
      <button class="btn-primary" @click="showForm = true">+ 品目を追加</button>
    </div>
    <p class="desc">OCRで読み取った品目名をここで登録した社内統一名称に自動変換します。キーワードを設定することで曖昧な品目名も照合できます。</p>

    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>社内統一名称</th><th>カテゴリ</th><th>勘定科目</th><th>照合キーワード</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-if="items.length === 0">
            <td colspan="5" class="empty">品目がありません</td>
          </tr>
          <tr v-for="item in items" :key="item.id">
            <td>{{ item.name }}</td>
            <td>{{ item.category ?? '-' }}</td>
            <td>{{ item.account_code ?? '-' }}</td>
            <td>
              <span v-for="kw in (item.keywords ?? [])" :key="kw" class="kw-tag">{{ kw }}</span>
            </td>
            <td><button class="btn-sm" @click="remove(item.id)">削除</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="showForm" class="modal-overlay" @click.self="showForm = false">
      <div class="modal">
        <h3>品目を追加</h3>
        <div class="field">
          <label>社内統一名称 <span class="required">*</span></label>
          <input v-model="form.name" type="text" placeholder="例: クラウドサービス利用料" />
        </div>
        <div class="field">
          <label>カテゴリ</label>
          <input v-model="form.category" type="text" placeholder="例: ソフトウェア" />
        </div>
        <div class="field">
          <label>勘定科目コード</label>
          <input v-model="form.account_code" type="text" placeholder="例: 5100" />
        </div>
        <div class="field">
          <label>照合キーワード（カンマ区切り）</label>
          <input v-model="keywordsInput" type="text" placeholder="例: 業務委託,委託費,外注" />
          <p class="hint">OCRで読み取った品目名にこのキーワードが含まれると自動マッチします</p>
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
import client from '@/api/client'

const items = ref<any[]>([])
const showForm = ref(false)
const form = ref({ name: '', category: '', account_code: '' })
const keywordsInput = ref('')

const load = async () => {
  const res = await client.get('/invoice-mgmt/item-masters')
  items.value = res.data
}

const save = async () => {
  if (!form.value.name) return
  const keywords = keywordsInput.value.split(',').map(k => k.trim()).filter(Boolean)
  await client.post('/invoice-mgmt/item-masters', { ...form.value, keywords })
  form.value = { name: '', category: '', account_code: '' }
  keywordsInput.value = ''
  showForm.value = false
  await load()
}

const remove = async (id: number) => {
  if (!confirm('削除しますか？')) return
  await client.delete(`/invoice-mgmt/item-masters/${id}`)
  await load()
}

onMounted(load)
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: .5rem; }
.desc { color: #64748b; font-size: .87rem; margin-bottom: 1.2rem; }
.btn-primary { background: #2563eb; color: #fff; padding: .5rem 1.2rem; border-radius: 6px; border: none; cursor: pointer; font-size: .9rem; }
.table-wrap { background: #fff; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.08); overflow: hidden; }
table { width: 100%; border-collapse: collapse; }
th { background: #f1f5f9; padding: .7rem 1rem; text-align: left; font-size: .82rem; color: #64748b; }
td { padding: .75rem 1rem; border-top: 1px solid #f1f5f9; font-size: .9rem; }
.empty { text-align: center; color: #94a3b8; padding: 2rem; }
.kw-tag { background: #eff6ff; color: #2563eb; border-radius: 4px; padding: .15rem .5rem; font-size: .78rem; margin-right: .3rem; }
.btn-sm { padding: .3rem .8rem; background: #fee2e2; color: #991b1b; border: none; border-radius: 4px; cursor: pointer; font-size: .8rem; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: #fff; border-radius: 8px; padding: 1.8rem; width: 480px; }
h3 { margin: 0 0 1.2rem; }
.field { margin-bottom: 1rem; }
label { display: block; font-size: .85rem; color: #374151; margin-bottom: .3rem; }
.required { color: #dc2626; }
input { width: 100%; padding: .55rem .8rem; border: 1px solid #ddd; border-radius: 6px; font-size: .9rem; box-sizing: border-box; }
.hint { font-size: .78rem; color: #94a3b8; margin-top: .3rem; }
.modal-actions { display: flex; gap: .8rem; justify-content: flex-end; margin-top: 1.2rem; }
.btn-secondary { padding: .5rem 1.2rem; background: #f1f5f9; color: #374151; border: 1px solid #ddd; border-radius: 6px; cursor: pointer; }
</style>
