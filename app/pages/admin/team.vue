<script setup lang="ts">
import { ref, reactive, computed } from 'vue'

definePageMeta({ layout: 'admin' })

/**
 * /admin/team — admin roster. Super-admin can invite new admins
 * (by email; Supabase sends a magic-link invite), change their role,
 * and remove them. Regular admins see the list read-only.
 */
interface AdminRow {
  user_id: string
  role: string
  added_at: string
  email: string | null
}

const { data, refresh, pending } = await useFetch<{
  admins: AdminRow[]
  me: { user_id: string; role: string }
}>('/api/admin/admins')

const isSuper = computed(() => data.value?.me.role === 'super')

const showForm = ref(false)
const form = reactive({ email: '', role: 'admin' as 'admin' | 'super' })
const submitting = ref(false)
const error = ref<string | null>(null)
const successMsg = ref<string | null>(null)

async function invite() {
  submitting.value = true
  error.value = null
  successMsg.value = null
  try {
    await $fetch('/api/admin/admins', {
      method: 'POST',
      body: { email: form.email, role: form.role },
    })
    successMsg.value = `Приглашение отправлено на ${form.email}`
    form.email = ''
    showForm.value = false
    await refresh()
  } catch (e: any) {
    const code = e?.data?.data?.code ?? e?.data?.code
    error.value =
      code === 'not_super' ? 'Только главный админ может добавлять'
      : code === 'invite_failed' ? 'Не удалось пригласить. Проверьте email'
      : 'Ошибка при добавлении'
  } finally {
    submitting.value = false
  }
}

async function remove(row: AdminRow) {
  if (typeof window !== 'undefined' && !window.confirm(`Удалить ${row.email ?? row.user_id} из админов?`)) return
  try {
    await $fetch(`/api/admin/admins/${row.user_id}`, { method: 'DELETE' })
    successMsg.value = 'Удалён'
    await refresh()
  } catch (e: any) {
    const code = e?.data?.data?.code ?? e?.data?.code
    error.value = code === 'cannot_remove_self' ? 'Нельзя удалить себя' : 'Ошибка удаления'
  }
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })
}
</script>

<template>
  <div>
    <div class="mb-6 flex items-end justify-between gap-4">
      <h1 class="heading-display-md">Команда</h1>
      <button
        v-if="isSuper"
        type="button"
        class="inline-flex h-10 items-center rounded-md bg-(--color-primary) px-5 text-sm font-medium text-(--color-primary-foreground) hover:opacity-90"
        @click="showForm = !showForm"
      >
        {{ showForm ? 'Отмена' : '+ Пригласить' }}
      </button>
    </div>

    <p v-if="successMsg" class="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
      {{ successMsg }}
    </p>
    <p v-if="error" class="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {{ error }}
    </p>

    <div
      v-if="showForm"
      class="mb-6 surface-card rounded-(--radius-xl) p-6"
    >
      <form class="grid grid-cols-[1fr_auto_auto] gap-3" @submit.prevent="invite">
        <div class="flex flex-col gap-1.5">
          <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">Email</label>
          <input
            v-model="form.email"
            type="email"
            required
            placeholder="teammate@example.com"
            class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm"
          >
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">Роль</label>
          <select
            v-model="form.role"
            class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm"
          >
            <option value="admin">Админ</option>
            <option value="super">Главный</option>
          </select>
        </div>
        <button
          type="submit"
          :disabled="submitting"
          class="h-11 self-end rounded-md bg-(--color-primary) px-5 text-sm font-medium text-(--color-primary-foreground) hover:opacity-90 disabled:opacity-60"
        >{{ submitting ? 'Добавляем…' : 'Пригласить' }}</button>
      </form>
      <p class="mt-3 text-[11px] text-(--color-muted-foreground)">
        Если у человека ещё нет аккаунта, на email придёт ссылка для входа. Если уже регистрировался — просто получит роль.
      </p>
    </div>

    <ul v-if="pending" class="grid gap-3" aria-busy="true">
      <li v-for="i in 2" :key="i">
        <div class="surface-card rounded-(--radius-xl) p-5">
          <Skeleton class="h-5 w-64" />
        </div>
      </li>
    </ul>

    <ul v-else-if="data?.admins.length" class="grid gap-3">
      <li v-for="row in data.admins" :key="row.user_id">
        <div class="surface-card grid grid-cols-[1fr_auto] items-center gap-4 rounded-(--radius-xl) p-5">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-medium">{{ row.email ?? '—' }}</p>
              <span
                :class="[
                  'rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider',
                  row.role === 'super'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-(--color-muted) text-(--color-muted-foreground)',
                ]"
              >{{ row.role === 'super' ? 'Главный' : 'Админ' }}</span>
              <span
                v-if="row.user_id === data.me.user_id"
                class="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] uppercase tracking-wider text-emerald-700"
              >вы</span>
            </div>
            <p class="mt-1 text-xs text-(--color-muted-foreground)">
              Добавлен: {{ fmtDate(row.added_at) }}
            </p>
          </div>
          <button
            v-if="isSuper && row.user_id !== data.me.user_id"
            type="button"
            class="inline-flex h-8 items-center rounded-full border border-red-200 bg-white px-3 text-xs text-red-700 hover:bg-red-50"
            @click="remove(row)"
          >Удалить</button>
        </div>
      </li>
    </ul>

    <div v-else class="surface-card rounded-(--radius-xl) p-10 text-center">
      <p class="text-(--color-muted-foreground)">Админов нет</p>
    </div>
  </div>
</template>
