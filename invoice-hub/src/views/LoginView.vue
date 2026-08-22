<template>
  <div class="login-wrap">
    <div class="login-card">
      <h1>Invoice Hub</h1>

      <form v-if="!challenge" @submit.prevent="submit">
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

      <!-- 信頼していない端末のときだけ表示される確認コードの入力 -->
      <form v-else @submit.prevent="submitCode">
        <p class="note">
          確認コードを <strong>{{ maskedEmail }}</strong> にお送りしました。<br />
          メールに記載の6桁の数字を入力してください。
        </p>
        <div class="field">
          <label>確認コード</label>
          <input
            v-model="code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            class="code"
            placeholder="000000"
            required
          />
        </div>
        <p v-if="error" class="error">{{ error }}</p>
        <button type="submit" :disabled="loading">
          {{ loading ? '確認中...' : 'ログイン' }}
        </button>
        <div class="sub-actions">
          <button type="button" class="link" :disabled="resendWait > 0" @click="resend">
            {{ resendWait > 0 ? `コードを再送する（${resendWait}秒後）` : 'コードを再送する' }}
          </button>
          <button type="button" class="link" @click="backToLogin('')">メールアドレスの入力に戻る</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

/* 2段階認証。challenge が入っているあいだはコード入力を表示する */
const challenge = ref('')
const maskedEmail = ref('')
const code = ref('')
const resendWait = ref(0)
let resendTimer: ReturnType<typeof setInterval> | null = null

const startResendCountdown = (seconds: number) => {
  if (resendTimer) clearInterval(resendTimer)
  resendWait.value = Math.max(0, Math.ceil(seconds))
  resendTimer = setInterval(() => {
    resendWait.value--
    if (resendWait.value <= 0 && resendTimer) clearInterval(resendTimer)
  }, 1000)
}

const backToLogin = (message: string) => {
  if (resendTimer) clearInterval(resendTimer)
  challenge.value = ''
  code.value = ''
  error.value = message
}

onUnmounted(() => { if (resendTimer) clearInterval(resendTimer) })

const submit = async () => {
  error.value = ''
  loading.value = true
  try {
    const mfa = await auth.login(email.value, password.value)
    if (mfa) {
      challenge.value = mfa.challenge
      maskedEmail.value = mfa.maskedEmail
      startResendCountdown(mfa.resendAfter)
      return
    }
    router.push('/')
  } catch {
    error.value = 'メールアドレスまたはパスワードが正しくありません'
  } finally {
    loading.value = false
  }
}

const submitCode = async () => {
  error.value = ''
  loading.value = true
  try {
    await auth.verifyLoginCode(email.value, challenge.value, code.value)
    router.push('/')
  } catch (e: any) {
    const data = e?.response?.data
    /* 期限切れ・試行超過はチャレンジ自体が無効。メール入力からやり直させる */
    if (data?.restart) { backToLogin(data.message); return }
    error.value = data?.message ?? '確認コードが正しくありません'
  } finally {
    loading.value = false
  }
}

const resend = async () => {
  error.value = ''
  try {
    const data = await auth.resendLoginCode(challenge.value)
    code.value = ''
    startResendCountdown(data.resend_after ?? 60)
  } catch (e: any) {
    const data = e?.response?.data
    if (data?.restart) { backToLogin(data.message); return }
    error.value = data?.message ?? '再送に失敗しました'
    startResendCountdown(data?.retry_after ?? 10)
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
.note { font-size: .85rem; color: #555; line-height: 1.7; margin-bottom: 1.2rem; }
input.code { font-family: 'Courier New', monospace; font-size: 1.4rem; letter-spacing: .5em; text-align: center; }
.sub-actions { display: flex; flex-direction: column; gap: .5rem; margin-top: 1rem; text-align: center; }
.link { width: auto; background: none; border: 0; padding: 0; margin: 0; color: #555; font-size: .85rem; text-decoration: underline; cursor: pointer; }
.link:disabled { opacity: .5; cursor: default; text-decoration: none; }
</style>
