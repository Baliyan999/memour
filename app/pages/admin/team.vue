<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useI18n } from '#imports'
import { RefreshCw } from '@lucide/vue'
import { formatDate } from '~/utils/format'

definePageMeta({ layout: 'admin' })

/**
 * /admin/team — admin roster.
 *
 * Super-admin can:
 *   • Add a new admin by setting email + password + Telegram chat ID
 *     directly (no email invitations — the super-admin shares the
 *     password with the teammate out-of-band).
 *   • Remove existing admins (except themselves and the last
 *     super-admin).
 *
 * Existing accounts are never modified: re-adding an admin is refused,
 * and an account that already exists (e.g. a removed admin coming
 * back) gets admin rights but keeps its own password.
 *
 * The 'super' role can't be assigned via the UI — it only exists for
 * the founding admin set via SQL. New admins are always role='admin'.
 *
 * Regular admins see the list read-only.
 *
 * The add form checks its fields itself (novalidate — the browser's
 * bubbles speak the browser's language) with the server's limits.
 */
interface AdminRow {
  user_id: string
  role: string
  added_at: string
  email: string | null
}

const { t, locale } = useI18n()
const { data, error: loadError, refresh, pending } = await useFetch<{
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
const errorMessage = useErrorMessage()

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/
const CHAT_ID_RE = /^\d{5,15}$/
const MIN_PASSWORD = 12 // server/api/admin/admins/index.post.ts

function validate(): string | null {
  if (!EMAIL_RE.test(form.email.trim())) return 'invalid_email'
  if (!CHAT_ID_RE.test(form.telegram_chat_id.trim())) return 'invalid_chat_id'
  if (form.password.length < MIN_PASSWORD) return 'password_too_short'
  return null
}

async function invite() {
  if (submitting.value) return
  const invalid = validate()
  if (invalid) {
    error.value = errorMessage(invalid)
    return
  }
  submitting.value = true
  error.value = null
  try {
    const res = await $fetch<{ ok: boolean; existing_account: boolean }>('/api/admin/admins', {
      method: 'POST',
      body: {
        email: form.email.trim(),
        password: form.password,
        telegram_chat_id: form.telegram_chat_id.trim(),
      },
    })
    toast.success(
      t(res.existing_account ? 'admin.team.addedExisting' : 'admin.team.added', { email: form.email.trim() }),
      res.existing_account ? 8000 : undefined,
    )
    form.email = ''
    form.password = ''
    form.telegram_chat_id = ''
    showForm.value = false
    await refresh()
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    submitting.value = false
  }
}

async function remove(row: AdminRow) {
  const ok = await confirmDialog({
    title: t('admin.team.removeTitle'),
    description: t('admin.team.removeDesc', { who: row.email ?? row.user_id }),
    confirmLabel: t('admin.team.remove'),
    cancelLabel: t('common.cancel'),
    tone: 'danger',
  })
  if (!ok) return
  try {
    await $fetch(`/api/admin/admins/${row.user_id}`, { method: 'DELETE' })
    toast.success(t('admin.team.removed'))
    await refresh()
  } catch (e) {
    toast.error(errorMessage(e))
  }
}

const fmtDate = (d: string) => formatDate(d, locale.value)
</script>

<template>
  <div>
    <div class="mb-6 flex items-end justify-between gap-4">
      <h1 class="heading-display-md">{{ t('admin.team.title') }}</h1>
      <button
        v-if="isSuper"
        type="button"
        class="inline-flex h-10 items-center rounded-md bg-(--color-primary) px-5 text-sm font-medium text-(--color-primary-foreground) hover:opacity-90"
        @click="showForm = !showForm"
      >{{ showForm ? t('common.cancel') : t('admin.team.add') }}</button>
    </div>

    <p v-if="error" role="alert" class="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>

    <div v-if="showForm" class="mb-6 surface-card rounded-(--radius-xl) p-6">
      <form class="flex flex-col gap-4" novalidate @submit.prevent="invite">
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="flex flex-col gap-1.5">
            <label for="team-email" class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">{{ t('admin.team.email') }}</label>
            <input
              id="team-email"
              v-model="form.email"
              type="email"
              autocomplete="off"
              placeholder="teammate@example.com"
              class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm"
            >
          </div>
          <div class="flex flex-col gap-1.5">
            <label for="team-chat" class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">{{ t('admin.team.chatId') }}</label>
            <input
              id="team-chat"
              v-model="form.telegram_chat_id"
              type="text"
              inputmode="numeric"
              maxlength="15"
              placeholder="123456789"
              class="h-11 rounded-md border border-(--color-border) bg-white px-3 font-mono text-sm"
            >
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <label for="team-password" class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">{{ t('admin.team.password') }}</label>
          <div class="relative">
            <input
              id="team-password"
              v-model="form.password"
              :type="showPwd ? 'text' : 'password'"
              autocomplete="new-password"
              :placeholder="t('admin.team.passwordPlaceholder')"
              class="h-11 w-full rounded-md border border-(--color-border) bg-white pl-3 pr-11 text-sm"
            >
            <button
              type="button"
              class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-(--color-muted-foreground) hover:text-(--color-foreground)"
              @click="showPwd = !showPwd"
            >{{ showPwd ? t('admin.team.hidePassword') : t('admin.team.showPassword') }}</button>
          </div>
        </div>

        <i18n-t
          keypath="admin.team.note"
          tag="p"
          scope="global"
          class="rounded-md border border-(--color-border) bg-(--color-muted)/30 px-3 py-2.5 text-[12px] text-(--color-muted-foreground)"
        >
          <template #creds><strong class="text-(--color-foreground)">{{ t('admin.team.noteCreds') }}</strong></template>
          <template #bot><code>@QRFotografBot</code></template>
          <template #idBot><code>@userinfobot</code></template>
        </i18n-t>

        <button
          type="submit"
          :disabled="submitting"
          class="inline-flex h-11 items-center justify-center rounded-md bg-(--color-primary) px-5 text-sm font-medium text-(--color-primary-foreground) hover:opacity-90 disabled:opacity-60"
        >{{ submitting ? t('admin.team.adding') : t('admin.team.submit') }}</button>
      </form>
    </div>

    <ul v-if="pending" class="grid gap-3" aria-busy="true">
      <li v-for="i in 2" :key="i">
        <div class="surface-card rounded-(--radius-xl) p-5">
          <Skeleton class="h-5 w-64" />
        </div>
      </li>
    </ul>

    <div v-else-if="loadError" class="surface-card rounded-(--radius-xl) p-10 text-center" role="alert">
      <p class="text-(--color-muted-foreground)">{{ errorMessage(loadError) }}</p>
      <button
        type="button"
        class="mt-5 inline-flex h-10 items-center gap-2 rounded-full border border-(--color-border) bg-white px-4 text-sm transition-[transform,background-color] duration-150 hover:bg-(--color-muted) active:scale-[0.97]"
        @click="refresh()"
      >
        <RefreshCw class="h-4 w-4" />
        {{ t('common.retry') }}
      </button>
    </div>

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
              >{{ row.role === 'super' ? t('admin.team.roleSuper') : t('admin.team.roleAdmin') }}</span>
              <span
                v-if="row.user_id === data.me.user_id"
                class="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] uppercase tracking-wider text-emerald-700"
              >{{ t('admin.team.you') }}</span>
            </div>
            <p class="mt-1 text-xs text-(--color-muted-foreground)">
              {{ t('admin.team.addedAt', { date: fmtDate(row.added_at) }) }}
            </p>
          </div>
          <button
            v-if="isSuper && row.user_id !== data.me.user_id"
            type="button"
            class="inline-flex h-8 items-center rounded-full border border-red-200 bg-white px-3 text-xs text-red-700 hover:bg-red-50"
            @click="remove(row)"
          >{{ t('admin.team.remove') }}</button>
        </div>
      </li>
    </ul>

    <div v-else class="surface-card rounded-(--radius-xl) p-10 text-center">
      <p class="text-(--color-muted-foreground)">{{ t('admin.team.empty') }}</p>
    </div>
  </div>
</template>
