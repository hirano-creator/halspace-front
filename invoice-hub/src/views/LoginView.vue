<template>
  <div class="login-wrap">
    <div class="login-card">
      <h1>Invoice Hub</h1>
      <form @submit.prevent="submit">
        <div class="field">
          <label>メールアドレス</label>
          <input v-model="email" type="email" required />
        </div>
        <div class="field">
          <label>パスワード</label>
          <input v-model="password" type="password" required />
        </div>
        <p v-if="error" class="error">{{ error }}</p>
        <button type="submit" :disabled="loading">
          {{ loading ? 'ログイン中...' : 'ログイン' }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

const submit = async () => {
  error.value = ''
  loading.value = true
  try {
    await auth.login(email.value, password.value)
    router.push('/')
  } catch {
    error.value = 'メールアドレスまたはパスワードが正しくありません'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f7fa;
}
.login-card {
  background: #fff;
  padding: 2.5rem;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0,0,0,.1);
  width: 360px;
}
h1 { text-align: center; margin-bottom: 1.5rem; font-size: 1.4rem; color: #2563eb; }
.field { margin-bottom: 1rem; }
label { display: block; font-size: .85rem; color: #555; margin-bottom: .3rem; }
input { width: 100%; padding: .6rem .8rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem; box-sizing: border-box; }
button { width: 100%; padding: .7rem; background: #2563eb; color: #fff; border: none; border-radius: 6px; font-size: 1rem; cursor: pointer; margin-top: .5rem; }
button:disabled { opacity: .6; cursor: not-allowed; }
.error { color: #dc2626; font-size: .85rem; margin-top: .5rem; }
</style>
