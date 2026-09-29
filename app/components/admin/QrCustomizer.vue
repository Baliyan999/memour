<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick, useId } from 'vue'
import { motion, AnimatePresence, useReducedMotion } from 'motion-v'
import { Download, X, Save, Trash2, Upload } from '@lucide/vue'

/**
 * Admin QR customizer modal — picks a style preset OR drills into
 * custom colors / gradient / logo, persists per-event in
 * events.qr_settings, then downloads a PDF.
 *
 *   v-model:open — show / hide
 *   eventId — UUID of the event whose PDF we generate + save against
 *   couple — couple_names for the preview caption
 *
 * Keyboard: focus moves into the dialog on open, Tab stays inside,
 * Esc closes, and focus goes back to the trigger on close.
 */
const props = defineProps<{
  open: boolean
  eventId: string
  couple: string
  tableCount?: number
}>()
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
}>()

const { toast } = useToast()
const errorMessage = useErrorMessage()
const { t } = useI18n()
const config = useRuntimeConfig()
const reduceMotion = useReducedMotion()
const dialogId = useId()

// Critically damped spring for the sheet; with reduced motion only a
// short cross-fade (content is never hidden, just not moved).
const sheetMotion = computed(() => reduceMotion.value
  ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
  : {
      initial: { opacity: 0, scale: 0.96, y: 16 },
      animate: { opacity: 1, scale: 1, y: 0 },
      exit: { opacity: 0, scale: 0.96, y: 16 },
      transition: { type: 'spring' as const, bounce: 0, visualDuration: 0.35 },
    })
const backdropTransition = computed(() => reduceMotion.value
  ? { duration: 0.15 }
  : { type: 'spring' as const, bounce: 0, visualDuration: 0.3 })

// Labels come from admin.qr.* in the page's language.
const PRESETS = [
  { id: 'mono', key: 'mono' },
  { id: 'rounded', key: 'rounded' },
  { id: 'dots', key: 'dots' },
  { id: 'classy', key: 'classy' },
  { id: 'leaf', key: 'leaf' },
  { id: 'gold', key: 'gold' },
  { id: 'rose', key: 'rose' },
  { id: 'midnight', key: 'midnight' },
  { id: 'gradient-gold', key: 'gradientGold' },
]
const LAYOUTS = ['2x2', '4x2', 'single'] as const
// Card language = the text printed on the cards AND the guest-page
// locale the QR opens.
const LANGS = [
  { id: 'uz', label: "O'zbekcha" },
  { id: 'ru', label: 'Русский' },
] as const
const DOTS = ['square', 'rounded', 'circle', 'classy'] as const
const CORNERS = ['square', 'rounded', 'circle', 'leaf'] as const

type Mode = 'preset' | 'custom'
const mode = ref<Mode>('preset')

const DEFAULTS = {
  style: 'mono',
  layout: '2x2',
  lang: 'uz' as 'uz' | 'ru',
  dot: 'square' as 'square' | 'rounded' | 'circle' | 'classy',
  corner: 'square' as 'square' | 'rounded' | 'circle' | 'leaf',
  fg: '#3a2010',
  bg: '#fbf6f0',
  useGradient: false,
  gFrom: '#9c7440',
  gTo: '#b85c5c',
  gAngle: 45,
}
const state = reactive({ ...DEFAULTS })

const logoFile = ref<File | null>(null)
const logoPreview = ref<string | null>(null)
const existingLogoPath = ref<string | null>(null)
const logoRemove = ref(false)
const saving = ref(false)
// Save / Download stay disabled until the saved settings are in —
// saving the defaults over them by accident is worse than waiting.
const loaded = ref(false)
const { pending: downloading, download } = useQrPdfDownload()

function close() {
  emit('update:open', false)
}

// ─── Focus ──────────────────────────────────────────────────────────
let returnFocus: HTMLElement | null = null
const dialogEl = () => document.getElementById(dialogId)

watch(() => props.open, async (isOpen, wasOpen) => {
  if (isOpen) {
    returnFocus = document.activeElement as HTMLElement | null
    await nextTick()
    // preventScroll: on a phone the dialog is taller than the screen and
    // still entering (scaled, offset); focusing it would scroll the
    // backdrop so the ✕ and the header open above the top edge.
    dialogEl()?.focus({ preventScroll: true })
  } else if (wasOpen) {
    returnFocus?.focus?.()
    returnFocus = null
  }
}, { immediate: true })

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (!props.open) return
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
  } else if (e.key === 'Tab') {
    // Keep Tab inside the dialog: wrap at both ends, and pull focus
    // back in if it's somewhere behind the backdrop.
    const root = dialogEl()
    if (!root) return
    const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
    if (!items.length) return
    const first = items[0]!
    const last = items[items.length - 1]!
    const active = document.activeElement as HTMLElement | null
    if (!active || !root.contains(active)) {
      e.preventDefault()
      first.focus()
    } else if (e.shiftKey && (active === first || active === root)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }
})

// Load saved settings on every open. `immediate`: the parent mounts
// this component already open, so a lazy watcher would miss the first.
watch(
  () => [props.open, props.eventId] as const,
  async ([isOpen]) => {
    if (!isOpen) return
    loaded.value = false
    // The modal is reused across events: start each one from defaults
    // so nothing carries over from the previous event.
    Object.assign(state, DEFAULTS)
    mode.value = 'preset'
    if (logoPreview.value?.startsWith('blob:')) URL.revokeObjectURL(logoPreview.value)
    logoPreview.value = null
    existingLogoPath.value = null
    logoFile.value = null
    logoRemove.value = false
    try {
      const res = await $fetch<{ settings: any; logo_url: string | null }>(
        `/api/admin/qr-settings/${props.eventId}`,
      )
      const s = res.settings ?? {}
      // The tab follows what was saved: 'custom' → "Свой стиль",
      // anything else is a preset id.
      mode.value = s.style === 'custom' ? 'custom' : 'preset'
      if (s.style && s.style !== 'custom') state.style = s.style
      if (s.layout) state.layout = s.layout
      if (s.lang === 'uz' || s.lang === 'ru') state.lang = s.lang
      // Custom fields are kept even after a preset save, so the
      // "Свой стиль" tab shows the last custom design.
      if (s.dot) state.dot = s.dot
      if (s.corner) state.corner = s.corner
      if (s.fg) state.fg = s.fg
      if (s.bg) state.bg = s.bg
      if (s.gradient) {
        state.useGradient = true
        state.gFrom = s.gradient.from
        state.gTo = s.gradient.to
        state.gAngle = s.gradient.angle ?? 45
      } else {
        state.useGradient = false
      }
      existingLogoPath.value = s.logo_path ?? null
      logoPreview.value = res.logo_url ?? null
      loaded.value = true
    } catch (e) {
      toast.error(errorMessage(e))
      close()
    }
  },
  { immediate: true },
)

const sampleUrl = computed(() =>
  `${config.public.siteUrl.replace(/\/+$/, '')}/${state.lang}/e/${props.eventId}?t=1`)

// Query describing the current choice — shared by preview and PDF so
// both render exactly the same thing.
function styleParams(): URLSearchParams {
  const params = new URLSearchParams()
  if (mode.value === 'preset') {
    params.set('style', state.style)
  } else {
    params.set('dot', state.dot)
    params.set('corner', state.corner)
    params.set('fg', state.fg)
    params.set('bg', state.bg)
    if (state.useGradient) {
      params.set('gFrom', state.gFrom)
      params.set('gTo', state.gTo)
      params.set('gAngle', String(state.gAngle))
    }
  }
  return params
}

const previewUrl = computed(() => {
  const params = styleParams()
  params.set('text', sampleUrl.value)
  return `/api/admin/qr-preview?${params.toString()}`
})

const perPage = computed(() => ({
  '2x2': 4,
  '4x2': 8,
  'single': 1,
}[state.layout] ?? 4))
const totalPages = computed(() => {
  const total = props.tableCount ?? 0
  if (!total) return 0
  return Math.ceil(total / perPage.value)
})
const pageSummary = computed(() => {
  if (!props.tableCount) return ''
  const last = props.tableCount % perPage.value
  if (last === 0 || totalPages.value === 1) return ''
  return t('admin.qr.lastPage', { n: last })
})

const downloadUrl = computed(() => {
  const params = styleParams()
  params.set('layout', state.layout)
  params.set('lang', state.lang)
  return `/api/admin/qr-pdf/${props.eventId}?${params.toString()}`
})

async function downloadPdf() {
  // The PDF takes the logo from the saved settings, so a logo picked (or
  // removed) but not saved yet would be in the preview and not on the
  // cards. Save it first: the PDF then matches the preview.
  if ((logoFile.value || logoRemove.value) && !(await save())) return
  try {
    await download(downloadUrl.value)
  } catch (e) {
    toast.error(errorMessage(e))
  }
}

function onLogoChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  logoFile.value = file
  logoRemove.value = false
  if (logoPreview.value?.startsWith('blob:')) URL.revokeObjectURL(logoPreview.value)
  logoPreview.value = URL.createObjectURL(file)
}

function removeLogo() {
  if (logoPreview.value?.startsWith('blob:')) URL.revokeObjectURL(logoPreview.value)
  logoPreview.value = null
  logoFile.value = null
  logoRemove.value = !!existingLogoPath.value
}

async function save(): Promise<boolean> {
  saving.value = true
  try {
    const settings: any = {
      style: mode.value === 'preset' ? state.style : 'custom',
      layout: state.layout,
      lang: state.lang,
    }
    if (mode.value === 'custom') {
      settings.dot = state.dot
      settings.corner = state.corner
      settings.fg = state.fg
      settings.bg = state.bg
      if (state.useGradient) {
        settings.gradient = { from: state.gFrom, to: state.gTo, angle: state.gAngle }
      } else {
        settings.gradient = null
      }
    }
    const fd = new FormData()
    fd.append('settings', JSON.stringify(settings))
    if (logoFile.value) fd.append('logo', logoFile.value)
    if (logoRemove.value) fd.append('logo_remove', '1')
    const res = await $fetch<{ settings: any }>(`/api/admin/qr-settings/${props.eventId}`, {
      method: 'POST',
      body: fd,
    })
    toast.success(t('admin.qr.saved'))
    existingLogoPath.value = res.settings?.logo_path ?? null
    logoFile.value = null
    logoRemove.value = false
    return true
  } catch (e) {
    // file_too_large_logo / unsupported_mime_logo / invalid_settings…
    toast.error(errorMessage(e, { variant: 'logo' }))
    return false
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <AnimatePresence>
      <!-- z-[90]: above the admin header (z-50), below the toast stack
           (z-100) so "saved" / error toasts stay readable. -->
      <motion.div
        v-if="open"
        :initial="{ opacity: 0 }"
        :animate="{ opacity: 1 }"
        :exit="{ opacity: 0 }"
        :transition="backdropTransition"
        class="fixed inset-0 z-[90] overflow-y-auto bg-black/40 backdrop-blur-sm"
      >
        <!-- min-h-full + centring: a dialog taller than the screen
             (phones) starts at the top and scrolls, instead of being
             centred with its top above the scroll origin. -->
        <div class="flex min-h-full items-center justify-center p-4 sm:p-8" @click.self="close">
          <motion.div
            :id="dialogId"
            :initial="sheetMotion.initial"
            :animate="sheetMotion.animate"
            :exit="sheetMotion.exit"
            :transition="sheetMotion.transition"
            class="surface-card relative w-full max-w-4xl overflow-hidden rounded-(--radius-xl) shadow-(--shadow-glow) outline-none"
            role="dialog"
            aria-modal="true"
            :aria-labelledby="`${dialogId}-title`"
            tabindex="-1"
          >
            <button
              type="button"
              :aria-label="t('common.close')"
              class="absolute right-4 top-4 z-10 grid h-8 w-8 place-items-center rounded-full border border-(--color-border) bg-white text-(--color-muted-foreground) hover:text-(--color-foreground)"
              @click="close"
            >
              <X class="h-4 w-4" :stroke-width="2" />
            </button>

            <div class="grid grid-cols-1 md:grid-cols-[1fr_1.4fr]">
              <!-- Preview -->
              <div class="border-b border-(--color-border) bg-(--color-muted)/20 p-8 md:border-b-0 md:border-r">
                <p class="text-[10px] uppercase tracking-[0.3em] text-(--color-muted-foreground)">{{ t('admin.qr.preview') }}</p>
                <p class="mt-1 font-display text-lg italic">{{ couple }}</p>
                <div class="relative mt-5 grid place-items-center rounded-(--radius-xl) bg-white p-5 shadow-sm">
                  <img :src="previewUrl" :alt="t('admin.qr.previewAlt')" class="h-auto w-full max-w-[260px]">
                  <!-- Logo overlay simulation (centered on top of SVG) -->
                  <img
                    v-if="logoPreview"
                    :src="logoPreview"
                    alt=""
                    class="pointer-events-none absolute inset-0 m-auto rounded-md"
                    style="width: 22%; height: 22%; object-fit: contain; padding: 2%"
                  >
                </div>
                <p class="mt-3 text-center text-xs text-(--color-muted-foreground)">
                  {{ t('admin.qr.previewCaption') }}
                </p>
              </div>

              <!-- Options -->
              <div class="flex flex-col gap-6 p-6 sm:p-8 md:max-h-[80vh] md:overflow-y-auto">
                <div>
                  <h2 :id="`${dialogId}-title`" class="heading-display-md" style="font-size: 1.5rem;">QR PDF</h2>
                  <p class="mt-1 text-sm text-(--color-muted-foreground)">
                    {{ t('admin.qr.subtitle') }}
                  </p>
                </div>

                <!-- Mode tabs -->
                <div class="flex gap-1 rounded-full border border-(--color-border) bg-white p-0.5">
                  <button
                    v-for="m in ['preset','custom'] as Mode[]"
                    :key="m"
                    type="button"
                    :class="[
                      'flex-1 rounded-full px-3 py-1.5 text-xs transition-colors',
                      mode === m
                        ? 'bg-(--color-primary) text-(--color-primary-foreground)'
                        : 'text-(--color-muted-foreground) hover:text-(--color-foreground)',
                    ]"
                    @click="mode = m"
                  >{{ m === 'preset' ? t('admin.qr.modePreset') : t('admin.qr.modeCustom') }}</button>
                </div>

                <!-- Preset mode -->
                <template v-if="mode === 'preset'">
                  <div>
                    <p class="mb-2 text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">{{ t('admin.qr.style') }}</p>
                    <div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      <button
                        v-for="p in PRESETS"
                        :key="p.id"
                        type="button"
                        :class="[
                          'flex flex-col items-center gap-1.5 rounded-md border bg-white p-2 transition-all',
                          state.style === p.id
                            ? 'border-(--color-primary) ring-2 ring-(--color-primary)/40'
                            : 'border-(--color-border) hover:border-(--color-primary)/40',
                        ]"
                        @click="state.style = p.id"
                      >
                        <img
                          :src="`/api/admin/qr-preview?style=${p.id}&text=preview`"
                          alt=""
                          class="aspect-square w-full"
                        >
                        <span class="text-[10px] text-(--color-foreground)">{{ t(`admin.qr.presets.${p.key}`) }}</span>
                      </button>
                    </div>
                  </div>
                </template>

                <!-- Custom mode -->
                <template v-else>
                  <div class="grid gap-3 sm:grid-cols-2">
                    <div class="flex flex-col gap-1">
                      <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">{{ t('admin.qr.dotsLabel') }}</label>
                      <select
                        v-model="state.dot"
                        class="h-10 rounded-md border border-(--color-border) bg-white px-3 text-sm"
                      >
                        <option v-for="d in DOTS" :key="d" :value="d">{{ t(`admin.qr.dots.${d}`) }}</option>
                      </select>
                    </div>
                    <div class="flex flex-col gap-1">
                      <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">{{ t('admin.qr.cornersLabel') }}</label>
                      <select
                        v-model="state.corner"
                        class="h-10 rounded-md border border-(--color-border) bg-white px-3 text-sm"
                      >
                        <option v-for="c in CORNERS" :key="c" :value="c">{{ t(`admin.qr.corners.${c}`) }}</option>
                      </select>
                    </div>
                  </div>

                  <div class="grid gap-3 sm:grid-cols-2">
                    <div class="flex flex-col gap-1">
                      <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">{{ t('admin.qr.fg') }}</label>
                      <div class="flex items-center gap-2">
                        <input v-model="state.fg" type="color" class="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-(--color-border) bg-white p-1">
                        <input v-model="state.fg" type="text" maxlength="7" class="h-10 min-w-0 flex-1 rounded-md border border-(--color-border) bg-white px-3 font-mono text-xs">
                      </div>
                    </div>
                    <div class="flex flex-col gap-1">
                      <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">{{ t('admin.qr.bg') }}</label>
                      <div class="flex items-center gap-2">
                        <input v-model="state.bg" type="color" class="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-(--color-border) bg-white p-1">
                        <input v-model="state.bg" type="text" maxlength="7" class="h-10 min-w-0 flex-1 rounded-md border border-(--color-border) bg-white px-3 font-mono text-xs">
                      </div>
                    </div>
                  </div>

                  <div>
                    <label class="flex cursor-pointer items-center gap-2 text-sm">
                      <input v-model="state.useGradient" type="checkbox" class="h-4 w-4 rounded border-(--color-border) accent-(--color-primary)">
                      <span>{{ t('admin.qr.gradient') }}</span>
                    </label>
                    <div v-if="state.useGradient" class="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                      <div class="flex flex-col gap-1">
                        <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">{{ t('admin.qr.color1') }}</label>
                        <input v-model="state.gFrom" type="color" class="h-10 w-full cursor-pointer rounded-md border border-(--color-border) bg-white p-1">
                      </div>
                      <div class="flex flex-col gap-1">
                        <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">{{ t('admin.qr.color2') }}</label>
                        <input v-model="state.gTo" type="color" class="h-10 w-full cursor-pointer rounded-md border border-(--color-border) bg-white p-1">
                      </div>
                      <div class="flex flex-col gap-1">
                        <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">{{ t('admin.qr.angle') }}</label>
                        <input v-model.number="state.gAngle" type="number" min="0" max="360" class="h-10 w-20 rounded-md border border-(--color-border) bg-white px-2 text-center text-sm">
                      </div>
                    </div>
                  </div>
                </template>

                <!-- Logo -->
                <div>
                  <p class="mb-2 text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">{{ t('admin.qr.logo') }}</p>
                  <div class="flex items-center gap-3">
                    <label class="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-(--color-border) bg-white px-4 text-sm hover:bg-(--color-muted)">
                      <Upload class="h-4 w-4" :stroke-width="1.6" />
                      {{ logoPreview ? t('admin.qr.logoChange') : t('admin.qr.logoUpload') }}
                      <input type="file" accept="image/png,image/jpeg,image/webp" class="hidden" @change="onLogoChange">
                    </label>
                    <button
                      v-if="logoPreview"
                      type="button"
                      class="inline-flex h-10 items-center gap-2 rounded-md border border-(--color-border) bg-white px-4 text-sm text-red-700 hover:bg-red-50"
                      @click="removeLogo"
                    >
                      <Trash2 class="h-4 w-4" :stroke-width="1.6" />
                      {{ t('admin.qr.logoRemove') }}
                    </button>
                  </div>
                  <p class="mt-2 text-[11px] text-(--color-muted-foreground)">
                    {{ t('admin.qr.logoHint') }}
                  </p>
                </div>

                <!-- Card language -->
                <div>
                  <p class="mb-2 text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">{{ t('admin.qr.cardLang') }}</p>
                  <div class="flex gap-1 rounded-full border border-(--color-border) bg-white p-0.5">
                    <button
                      v-for="l in LANGS"
                      :key="l.id"
                      type="button"
                      :class="[
                        'flex-1 rounded-full px-3 py-1.5 text-xs transition-colors',
                        state.lang === l.id
                          ? 'bg-(--color-primary) text-(--color-primary-foreground)'
                          : 'text-(--color-muted-foreground) hover:text-(--color-foreground)',
                      ]"
                      @click="state.lang = l.id"
                    >{{ l.label }}</button>
                  </div>
                  <p class="mt-2 text-[11px] text-(--color-muted-foreground)">
                    {{ t('admin.qr.cardLangHint') }}
                  </p>
                </div>

                <!-- Layout -->
                <div>
                  <p class="mb-2 text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">{{ t('admin.qr.layout') }}</p>
                  <p v-if="tableCount" class="mb-2 text-[11px] text-(--color-muted-foreground)">
                    {{ t('admin.qr.pagesSummary', { tables: tableCount, pages: totalPages }) }}
                    <template v-if="pageSummary"> {{ pageSummary }}</template>
                  </p>
                  <div class="grid gap-2">
                    <button
                      v-for="l in LAYOUTS"
                      :key="l"
                      type="button"
                      :class="[
                        'flex items-center justify-between rounded-md border bg-white px-4 py-3 text-left transition-colors',
                        state.layout === l
                          ? 'border-(--color-primary) ring-2 ring-(--color-primary)/40'
                          : 'border-(--color-border) hover:border-(--color-primary)/40',
                      ]"
                      @click="state.layout = l"
                    >
                      <div>
                        <p class="text-sm font-medium">{{ t(`admin.qr.layouts.${l}.label`) }}</p>
                        <p class="text-xs text-(--color-muted-foreground)">{{ t(`admin.qr.layouts.${l}.desc`) }}</p>
                      </div>
                      <span
                        :class="[
                          'grid h-5 w-5 place-items-center rounded-full border-2',
                          state.layout === l
                            ? 'border-(--color-primary) bg-(--color-primary)'
                            : 'border-(--color-border)',
                        ]"
                      >
                        <span v-if="state.layout === l" class="h-2 w-2 rounded-full bg-white" />
                      </span>
                    </button>
                  </div>
                </div>

                <!-- Actions -->
                <div class="mt-auto flex gap-2">
                  <button
                    type="button"
                    :disabled="saving || !loaded"
                    class="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md border border-(--color-border) bg-white text-sm hover:bg-(--color-muted) disabled:opacity-60"
                    @click="save"
                  >
                    <Save class="h-4 w-4" :stroke-width="1.8" />
                    {{ saving ? t('admin.qr.saving') : t('admin.qr.save') }}
                  </button>
                  <button
                    type="button"
                    :disabled="downloading || saving || !loaded"
                    class="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-(--color-primary) px-5 text-sm font-medium text-(--color-primary-foreground) hover:opacity-95 disabled:opacity-60"
                    @click="downloadPdf"
                  >
                    <Download class="h-4 w-4" :stroke-width="1.8" />
                    {{ downloading ? t('admin.qr.downloading') : t('admin.qr.download') }}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  </Teleport>
</template>
