<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n, useLocalePath } from '#imports'
import { RefreshCw } from '@lucide/vue'
import imageCompression from 'browser-image-compression'
import type { Database } from '~/types/database.types'

definePageMeta({ layout: 'dashboard' })

/**
 * /dashboard/event/[id]/branding — couple edits the look of their
 * guest-facing landing: bride/groom names, accent color, greeting,
 * cover photo. Posts to /api/couple/branding/[id] as multipart so the
 * file ride can ride along the text fields.
 *
 * The cover is shrunk in the browser first (≤2000px, ~1.5 MB): phone
 * originals are 4–10 MB, which proxies reject before our handler runs
 * — and the text edits in the same request would be lost with it.
 *
 * If the current settings can't be loaded, the form isn't shown at
 * all: saving an empty form would overwrite the names and greeting.
 */
const { t } = useI18n()
const errorMessage = useErrorMessage()
const route = useRoute()
const localePath = useLocalePath()
const supabase = useSupabaseClient<Database>()

const id = route.params.id as string

const { data: ev, error: loadErr, pending: loadPending, refresh } = await useAsyncData(`event-branding-${id}`, async () => {
  const { data, error } = await supabase
    .from('events')
    .select('id, couple_names, branding(*)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
})
// No row (RLS hides other couples' events too) → the localized 404 page.
if (!loadErr.value && !ev.value) {
  throw createError({ statusCode: 404, statusMessage: 'event_not_found', fatal: true })
}

const form = reactive({
  bride_name: '',
  groom_name: '',
  accent_color: '#a67c52',
  greeting_text: '',
})
const coverFile = ref<File | null>(null)
const coverPreviewUrl = ref<string | null>(null)
const pending = ref(false)
const saved = ref(false)
const error = ref<string | null>(null)

function fillForm() {
  const b = (ev.value as any)?.branding
  if (b) {
    form.bride_name = b.bride_name ?? ''
    form.groom_name = b.groom_name ?? ''
    form.accent_color = b.accent_color ?? '#a67c52'
    form.greeting_text = b.greeting_text ?? ''
    if (b.cover_photo) coverPreviewUrl.value = b.cover_photo
  }
}
onMounted(fillForm)

async function retryLoad() {
  await refresh()
  fillForm()
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

function onCoverChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  coverFile.value = file
  if (coverPreviewUrl.value && coverPreviewUrl.value.startsWith('blob:')) {
    URL.revokeObjectURL(coverPreviewUrl.value)
  }
  coverPreviewUrl.value = URL.createObjectURL(file)
}

async function save() {
  if (pending.value) return
  if (!HEX_RE.test(form.accent_color)) {
    saved.value = false
    error.value = errorMessage('invalid_color')
    return
  }
  pending.value = true
  saved.value = false
  error.value = null
  try {
    const fd = new FormData()
    fd.append('bride_name', form.bride_name)
    fd.append('groom_name', form.groom_name)
    fd.append('accent_color', form.accent_color)
    fd.append('greeting_text', form.greeting_text)
    if (coverFile.value) {
      let file: Blob = coverFile.value
      if (/^image\/(jpeg|png|webp)$/.test(file.type)) {
        try {
          file = await imageCompression(coverFile.value, {
            maxSizeMB: 1.5,
            maxWidthOrHeight: 2000,
            useWebWorker: true,
            initialQuality: 0.85,
          })
        } catch {
          // Can't decode it here — let the server judge the original.
        }
      }
      fd.append('cover_photo', file, coverFile.value.name)
    }
    const res = await $fetch<{ ok: boolean; cover_photo: string | null }>(
      `/api/couple/branding/${id}`,
      { method: 'POST', body: fd },
    )
    saved.value = true
    if (res.cover_photo) coverPreviewUrl.value = res.cover_photo
    coverFile.value = null
  } catch (e: any) {
    // file_too_large_cover / unsupported_mime_cover; a proxy's 413 page
    // has no code, but its status still means "too big".
    error.value = errorMessage(e, { variant: 'cover', fallback: 'couple.branding.saveFailed' })
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <NuxtLink
      :to="localePath(`/dashboard/event/${id}`)"
      class="mb-3 inline-flex items-center gap-1.5 text-sm text-(--color-muted-foreground) hover:text-(--color-foreground)"
    >
      <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
      {{ t('couple.event.back') }}
    </NuxtLink>
    <h1 class="heading-display-md mb-1">{{ t('couple.branding.title') }}</h1>
    <p class="mb-6 text-(--color-muted-foreground)">
      {{ t('couple.branding.desc') }}
    </p>

    <!-- Current settings didn't load: no form to save over them -->
    <div v-if="loadErr" class="surface-card rounded-(--radius-xl) p-10 text-center" role="alert">
      <p class="text-(--color-muted-foreground)">{{ errorMessage(loadErr) }}</p>
      <button
        type="button"
        :disabled="loadPending"
        class="mt-5 inline-flex h-10 items-center gap-2 rounded-full border border-(--color-border) bg-white px-4 text-sm transition-[transform,background-color] duration-150 hover:bg-(--color-muted) active:scale-[0.97] disabled:opacity-60"
        @click="retryLoad"
      >
        <RefreshCw class="h-4 w-4" :class="loadPending ? 'animate-spin' : ''" />
        {{ t('common.retry') }}
      </button>
    </div>

    <form v-else class="surface-card flex flex-col gap-5 rounded-(--radius-xl) p-7" novalidate @submit.prevent="save">
      <!-- Cover photo -->
      <div class="flex flex-col gap-2">
        <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">
          {{ t('couple.branding.cover') }}
        </label>
        <div
          class="relative aspect-[4/3] overflow-hidden rounded-md border border-(--color-border) bg-(--color-muted)"
        >
          <img
            v-if="coverPreviewUrl"
            :src="coverPreviewUrl"
            alt=""
            class="h-full w-full object-cover"
          >
          <div v-else class="grid h-full w-full place-items-center text-(--color-muted-foreground)">
            {{ t('couple.branding.noPhoto') }}
          </div>
        </div>
        <label class="inline-flex h-10 cursor-pointer items-center justify-center self-start rounded-md border border-(--color-border) bg-white px-4 text-sm hover:bg-(--color-muted)">
          {{ coverPreviewUrl ? t('couple.branding.changePhoto') : t('couple.branding.pickPhoto') }}
          <input type="file" accept="image/jpeg,image/png,image/webp" class="hidden" @change="onCoverChange">
        </label>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div class="flex flex-col gap-1.5">
          <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">
            {{ t('couple.branding.brideName') }}
          </label>
          <input
            v-model="form.bride_name"
            type="text"
            maxlength="80"
            class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)"
          >
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">
            {{ t('couple.branding.groomName') }}
          </label>
          <input
            v-model="form.groom_name"
            type="text"
            maxlength="80"
            class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)"
          >
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">
          {{ t('couple.branding.accentColor') }}
        </label>
        <div class="flex items-center gap-3">
          <input
            v-model="form.accent_color"
            type="color"
            class="h-11 w-14 cursor-pointer rounded-md border border-(--color-border) bg-white p-1"
          >
          <input
            v-model="form.accent_color"
            type="text"
            maxlength="7"
            :aria-invalid="error && !HEX_RE.test(form.accent_color) ? 'true' : undefined"
            class="h-11 flex-1 rounded-md border border-(--color-border) bg-white px-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)"
          >
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">
          {{ t('couple.branding.greeting') }}
        </label>
        <textarea
          v-model="form.greeting_text"
          rows="3"
          maxlength="400"
          :placeholder="t('couple.branding.greetingPlaceholder')"
          class="rounded-md border border-(--color-border) bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)"
        />
        <p class="text-[11px] text-(--color-muted-foreground)">
          {{ form.greeting_text.length }} / 400
        </p>
      </div>

      <p v-if="error" role="alert" class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        {{ error }}
      </p>
      <p v-if="saved" class="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
        {{ t('couple.branding.saved') }}
      </p>

      <button
        type="submit"
        :disabled="pending"
        class="inline-flex h-12 items-center justify-center rounded-md bg-(--color-primary) text-sm font-medium text-(--color-primary-foreground) shadow-(--shadow-soft) hover:opacity-90 disabled:opacity-60"
      >
        {{ pending ? t('couple.branding.saving') : t('couple.branding.save') }}
      </button>
    </form>
  </div>
</template>
