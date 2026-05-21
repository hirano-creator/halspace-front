<template>
  <span class="badge" :class="status">{{ label }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ status: string }>()

const labelMap: Record<string, string> = {
  unlinked: '未紐づけ',
  pending:  '承認待ち',
  approved: '承認済み',
  paid:     '支払済み',
  rejected: '却下',
  draft:    '下書き',
}

const label = computed(() => labelMap[props.status] ?? props.status)
</script>

<style scoped>
.badge { display: inline-block; padding: .2rem .65rem; border-radius: 999px; font-size: .78rem; font-weight: 600; }
.unlinked { background: #fef3c7; color: #92400e; }
.pending  { background: #dbeafe; color: #1e40af; }
.approved { background: #dcfce7; color: #166534; }
.paid     { background: #f0fdf4; color: #15803d; }
.rejected { background: #fee2e2; color: #991b1b; }
.draft    { background: #f1f5f9; color: #475569; }
</style>
