import { defineStore } from 'pinia'
import { ref } from 'vue'
import client from '@/api/client'

interface User {
  id: number
  name: string
  email: string
  company_id: number
}

/** 2段階認証が必要なときに login() が返す情報 */
export interface MfaChallenge {
  mfaRequired: true
  challenge: string
  maskedEmail: string
  resendAfter: number
}

/* 信頼済み端末のトークン。ユーザー情報を含まない不透明な文字列で、
   サーバー側で「そのユーザーのものか」を必ず検証している。
   1台の端末を複数アカウントで使うため、メールごとに分けて保存する。 */
const DEVICE_STORE_KEY = 'invoice_device_tokens'

function emailKey(email: string): string {
  let h = 0x811c9dc5
  const s = String(email || '').trim().toLowerCase()
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function readDeviceStore(): Record<string, string> {
  try {
    const obj = JSON.parse(localStorage.getItem(DEVICE_STORE_KEY) ?? '{}')
    return obj && typeof obj === 'object' ? obj : {}
  } catch {
    return {}
  }
}

function deviceToken(email: string): string | null {
  return readDeviceStore()[emailKey(email)] ?? null
}

function saveDeviceToken(email: string, token: string) {
  try {
    const store = readDeviceStore()
    store[emailKey(email)] = token
    localStorage.setItem(DEVICE_STORE_KEY, JSON.stringify(store))
  } catch {
    /* 保存できなければ毎回コード入力になるだけ */
  }
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const token = ref<string | null>(localStorage.getItem('token'))

  const applySession = (data: { token: string; user: User }) => {
    token.value = data.token
    user.value = data.user
    localStorage.setItem('token', data.token)
  }

  /**
   * 信頼済み端末ならそのままログインが完了し null を返す。
   * そうでなければトークンは発行されず、確認コードの入力が必要になる。
   */
  const login = async (email: string, password: string): Promise<MfaChallenge | null> => {
    const res = await client.post('/auth/login', {
      email,
      password,
      device_token: deviceToken(email),
    })

    if (res.data.mfa_required) {
      return {
        mfaRequired: true,
        challenge: res.data.challenge,
        maskedEmail: res.data.masked_email,
        resendAfter: res.data.resend_after ?? 60,
      }
    }

    applySession(res.data)
    return null
  }

  /** 確認コードの照合。コード誤りはAPIが422を返す（401だと共通処理でログイン画面へ飛ばされる） */
  const verifyLoginCode = async (email: string, challenge: string, code: string, rememberDevice = true) => {
    const res = await client.post('/auth/login/verify', {
      challenge,
      code,
      remember_device: rememberDevice,
    })

    applySession(res.data)
    if (res.data.device_token) saveDeviceToken(email, res.data.device_token)
  }

  const resendLoginCode = async (challenge: string) => {
    const res = await client.post('/auth/login/resend', { challenge })
    return res.data as { resend_after?: number }
  }

  const logout = async () => {
    await client.post('/auth/logout').catch(() => {})
    token.value = null
    user.value = null
    localStorage.removeItem('token')
  }

  const fetchMe = async () => {
    const res = await client.get('/auth/me')
    user.value = res.data
  }

  const isLoggedIn = () => !!token.value

  return { user, token, login, verifyLoginCode, resendLoginCode, logout, fetchMe, isLoggedIn }
})
