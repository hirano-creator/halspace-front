<template>
  <AppLayout>
    <div class="page-header">
      <h2>請求書を登録</h2>
    </div>

    <div class="upload-card">
      <div
        class="drop-zone"
        :class="{ dragover }"
        @dragover.prevent="dragover = true"
        @dragleave="dragover = false"
        @drop.prevent="onDrop"
        @click="fileInput?.click()"
      >
        <div v-if="!file">
          <p>PDFをドラッグ＆ドロップ</p>
          <p class="sub">またはクリックしてファイルを選択</p>
        </div>
        <div v-else class="file-name">
          📄 {{ file.name }}
          <button @click.stop="file = null">✕</button>
        </div>
        <input ref="fileInput" type="file" accept="application/pdf" hidden @change="onFileChange" />
      </div>

      <div v-if="uploading" class="progress">
        OCR読み取り中... しばらくお待ちください
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <button class="btn-primary" :disabled="!file || uploading" @click="upload">
        {{ uploading ? 'アップロード中...' : 'アップロードして登録' }}
      </button>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import AppLayout from '@/components/common/AppLayout.vue'
import { invoicesApi } from '@/api/invoices'

const router = useRouter()
const file = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const dragover = ref(false)
const uploading = ref(false)
const error = ref('')

const onDrop = (e: DragEvent) => {
  dragover.value = false
  const f = e.dataTransfer?.files[0]
  if (f?.type === 'application/pdf') file.value = f
}

const onFileChange = (e: Event) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) file.value = f
}

const upload = async () => {
  if (!file.value) return
  uploading.value = true
  error.value = ''
  try {
    const fd = new FormData()
    fd.append('pdf', file.value)
    const res = await invoicesApi.upload(fd)
    router.push(`/invoices/${res.data.id}`)
  } catch {
    error.value = 'アップロードに失敗しました。もう一度お試しください。'
  } finally {
    uploading.value = false
  }
}
</script>

<style scoped>
.page-header { margin-bottom: 1.5rem; }
.upload-card { background: #fff; border-radius: 8px; padding: 2rem; max-width: 560px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
.drop-zone {
  border: 2px dashed #cbd5e1; border-radius: 8px; padding: 3rem 2rem; text-align: center;
  cursor: pointer; transition: background .15s; margin-bottom: 1.5rem; color: #64748b;
}
.drop-zone:hover, .drop-zone.dragover { background: #eff6ff; border-color: #2563eb; }
.sub { font-size: .85rem; color: #94a3b8; margin-top: .4rem; }
.file-name { color: #1e293b; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: .8rem; }
.file-name button { background: none; border: none; cursor: pointer; color: #94a3b8; font-size: 1rem; }
.progress { text-align: center; color: #2563eb; margin-bottom: 1rem; font-size: .9rem; }
.btn-primary {
  width: 100%; padding: .75rem; background: #2563eb; color: #fff; border: none;
  border-radius: 6px; font-size: 1rem; cursor: pointer;
}
.btn-primary:disabled { opacity: .5; cursor: not-allowed; }
.error { color: #dc2626; font-size: .85rem; margin-bottom: .8rem; }
</style>
