import { defineStore } from 'pinia'
import { ref } from 'vue'
import client from '@/api/client'

interface User {
  id: number
  name: string
  email: string
  company_id: number
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const token = ref<string | null>(localStorage.getItem('token'))

  const login = async (email: string, password: string) => {
    const res = await client.post('/auth/login', { email, password })
    token.value = res.data.token
    user.value = res.data.user
    localStorage.setItem('token', res.data.token)
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

  return { user, token, login, logout, fetchMe, isLoggedIn }
})
