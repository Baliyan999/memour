<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n, useLocalePath } from '#imports'
import type { Database } from '~/types/database.types'

definePageMeta({ layout: 'dashboard' })

/**
 * /dashboard/event/[id]/branding — couple edits the look of their
 * guest-facing landing: bride/groom names, accent color, greeting,
 * cover photo. Posts to /api/couple/branding/[id] as multipart so the
 * file ride can ride along the text fields.
 */
const { t } = useI18n()
const route = useRoute()
const localePath = useLocalePath()
const supabase = useSupabaseClient<Database>()

const id = route.params.id as string

const { data: ev } = await useAsyncData(`event-branding-${id}`, async () => {
  const { data, error } = await supabase
    .from('events')
    .select('id, couple_names, branding(*)')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
})

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

onMounted(() => {
  const b = (ev.value as any)?.branding
  if (b) {
    form.bride_name = b.bride_name ?? ''
    form.groom_name = b.groom_name ?? ''
    form.accent_color = b.accent_color ?? '#a67c52'
    form.greeting_text = b.greeting_text ?? ''
    if (b.cover_photo) coverPreviewUrl.value = b.cover_photo
  }
})

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
  pending.value = true
  saved.value = false
  error.value = null
  try {
    const fd = new FormData()
    fd.append('bride_name', form.bride_name)
    fd.append('groom_name', form.groom_name)
    fd.append('accent_color', form.accent_color)
    fd.append('greeting_text', form.greeting_text)
    if (coverFile.value) fd.append('cover_photo', coverFile.value)
    const res = await $fetch<{ ok: boolean; cover_photo: string | null }>(
      `/api/couple/branding/${id}`,
      { method: 'POST', body: fd },
    )
    saved.value = true
    if (res.cover_photo) coverPreviewUrl.value = res.cover_photo
    coverFile.value = null
  } catch (e: any) {
    const code = e?.data?.data?.code ?? e?.data?.code
    error.value =
      code === 'file_too_large'
        ? t('couple.branding.tooLarge')
        : code === 'unsupported_mime'
          ? t('couple.branding.unsupportedFormat')
          : t('couple.branding.saveFailed')
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

    <form class="surface-card flex flex-col gap-5 rounded-(--radius-xl) p-7" @submit.prevent="save">
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
          <input type="file" accept="image/*" class="hidden" @change="onCoverChange">
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
            pattern="^#[0-9a-fA-F]{6}$"
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

      <p v-if="error" class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
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
