<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">Invoice Hub</div>
      <nav>
        <router-link to="/">ダッシュボード</router-link>
        <router-link to="/invoices">請求書一覧</router-link>
        <router-link to="/invoices/new">請求書を登録</router-link>
        <router-link to="/purchase-requests">購入申請</router-link>
        <router-link to="/vendors">仕入先</router-link>
        <router-link to="/item-masters">品目マスター</router-link>
      </nav>
      <div class="logout">
        <button @click="logout">ログアウト</button>
      </div>
    </aside>
    <main class="content">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'

const auth = useAuthStore()
const router = useRouter()

const logout = async () => {
  await auth.logout()
  router.push('/login')
}
</script>

<style scoped>
.layout { display: flex; min-height: 100vh; }
.sidebar {
  width: 220px; background: #1e293b; color: #fff; display: flex; flex-direction: column;
  padding: 0; flex-shrink: 0;
}
.brand { padding: 1.5rem 1.2rem; font-size: 1.1rem; font-weight: 700; color: #60a5fa; border-bottom: 1px solid #334155; }
nav { flex: 1; padding: 1rem 0; }
nav a {
  display: block; padding: .65rem 1.2rem; color: #cbd5e1; text-decoration: none; font-size: .92rem;
  transition: background .15s;
}
nav a:hover, nav a.router-link-active { background: #2563eb; color: #fff; }
.logout { padding: 1rem 1.2rem; border-top: 1px solid #334155; }
.logout button {
  width: 100%; padding: .5rem; background: transparent; border: 1px solid #475569;
  color: #94a3b8; border-radius: 6px; cursor: pointer; font-size: .85rem;
}
.logout button:hover { background: #334155; }
.content { flex: 1; padding: 2rem; background: #f8fafc; overflow-y: auto; }
</style>
