<script setup lang="ts">
import { ref, reactive, computed } from 'vue'

definePageMeta({ layout: 'admin' })

/**
 * /admin/team — admin roster.
 *
 * Super-admin can:
 *   • Add a new admin by setting email + password + Telegram chat ID
 *     directly (no email invitations — the super-admin shares the
 *     password with the teammate out-of-band).
 *   • Remove existing admins (except themselves).
 *
 * The 'super' role can't be assigned via the UI — it only exists for
 * the founding admin set via SQL. New admins are always role='admin'.
 *
 * Regular admins see the list read-only.
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
const form = reactive({
  email: '',
  password: '',
  telegram_chat_id: '',
})
const showPwd = ref(false)
const submitting = ref(false)
const error = ref<string | null>(null)
const { toast } = useToast()

async function invite() {
  submitting.value = true
  error.value = null
  try {
    await $fetch('/api/admin/admins', {
      method: 'POST',
      body: {
        email: form.email,
        password: form.password,
        telegram_chat_id: form.telegram_chat_id,
      },
    })
    toast.success(`Админ добавлен: ${form.email}`)
    form.email = ''
    form.password = ''
    form.telegram_chat_id = ''
    showForm.value = false
    await refresh()
  } catch (e: any) {
    const code = e?.data?.data?.code ?? e?.data?.code
    error.value =
      code === 'not_super' ? 'Только главный админ может добавлять'
      : code === 'invalid_input' ? 'Проверьте поля. Chat ID — только цифры, пароль ≥ 6 символов'
      : code === 'create_failed' ? 'Не удалось создать аккаунт'
      : code === 'update_failed' ? 'Не удалось обновить пароль существующего аккаунта'
      : 'Ошибка при добавлении'
  } finally {
    submitting.value = false
  }
}

async function remove(row: AdminRow) {
  const ok = await confirmDialog({
    title: 'Удалить администратора?',
    description: `Аккаунт ${row.email ?? row.user_id} потеряет доступ к админ-панели. Сам Supabase-аккаунт сохранится.`,
    confirmLabel: 'Удалить',
    cancelLabel: 'Отмена',
    tone: 'danger',
  })
  if (!ok) return
  try {
    await $fetch(`/api/admin/admins/${row.user_id}`, { method: 'DELETE' })
    toast.success('Удалён')
    await refresh()
  } catch (e: any) {
    const code = e?.data?.data?.code ?? e?.data?.code
    toast.error(code === 'cannot_remove_self' ? 'Нельзя удалить себя' : 'Ошибка удаления')
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
      >{{ showForm ? 'Отмена' : '+ Добавить админа' }}</button>
    </div>

    <p v-if="error" class="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>

    <div v-if="showForm" class="mb-6 surface-card rounded-(--radius-xl) p-6">
      <form class="flex flex-col gap-4" @submit.prevent="invite">
        <div class="grid gap-4 sm:grid-cols-2">
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
            <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">Telegram chat ID</label>
            <input
              v-model="form.telegram_chat_id"
              type="text"
              required
              pattern="\d{5,15}"
              placeholder="718997850"
              class="h-11 rounded-md border border-(--color-border) bg-white px-3 font-mono text-sm"
            >
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">Пароль</label>
          <div class="relative">
            <input
              v-model="form.password"
              :type="showPwd ? 'text' : 'password'"
              required
              minlength="6"
              placeholder="минимум 6 символов"
              class="h-11 w-full rounded-md border border-(--color-border) bg-white pl-3 pr-11 text-sm"
            >
            <button
              type="button"
              class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-(--color-muted-foreground) hover:text-(--color-foreground)"
              @click="showPwd = !showPwd"
            >{{ showPwd ? 'скрыть' : 'показать' }}</button>
          </div>
        </div>

        <p class="rounded-md border border-(--color-border) bg-(--color-muted)/30 px-3 py-2.5 text-[12px] text-(--color-muted-foreground)">
          📨 Передайте напарнику <strong class="text-(--color-foreground)">email + пароль</strong> устно или в личке.
          При входе сюда наша система пришлёт ему 6-значный код в указанный
          Telegram-chat (он узнает свой chat ID, написав боту
          <code>@QRFotografBot</code> и проверив свой ID, например через
          <code>@userinfobot</code>).
        </p>

        <button
          type="submit"
          :disabled="submitting"
          class="inline-flex h-11 items-center justify-center rounded-md bg-(--color-primary) px-5 text-sm font-medium text-(--color-primary-foreground) hover:opacity-90 disabled:opacity-60"
        >{{ submitting ? 'Добавляем…' : 'Добавить' }}</button>
      </form>
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
