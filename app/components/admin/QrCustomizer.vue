<script setup lang="ts">
import { Download, Save, Trash2, Upload, X } from '@lucide/vue'
import { AnimatePresence, motion } from 'motion-v'
import { computed, reactive, ref, watch } from 'vue'

/**
 * Admin QR customizer modal — picks a style preset OR drills into
 * custom colors / gradient / logo, persists per-event in
 * events.qr_settings, then downloads a PDF.
 *
 *   v-model:open — show / hide
 *   eventId — UUID of the event whose PDF we generate + save against
 *   couple — couple_names for the preview caption
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

const PRESETS = [
  { id: 'mono', label: 'Классика' },
  { id: 'rounded', label: 'Скруглённый' },
  { id: 'dots', label: 'Точки' },
  { id: 'classy', label: 'Бусины' },
  { id: 'leaf', label: 'Лепесток' },
  { id: 'gold', label: 'Золото' },
  { id: 'rose', label: 'Роза' },
  { id: 'midnight', label: 'Полночь' },
  { id: 'gradient-gold', label: 'Градиент' },
]
const LAYOUTS = [
  { id: '2x2', label: 'По 4 на странице', desc: 'A4, сетка 2×2 — стандарт' },
  { id: '4x2', label: 'По 8 на странице', desc: 'A4, сетка 4×2 — компактнее' },
  { id: 'single', label: 'Крупный', desc: 'Один QR на всю страницу A4' },
]
const DOTS = [
  { id: 'square', label: 'Квадраты' },
  { id: 'rounded', label: 'Скруглённые' },
  { id: 'circle', label: 'Круги' },
  { id: 'classy', label: 'Бусины' },
]
const CORNERS = [
  { id: 'square', label: 'Прямые' },
  { id: 'rounded', label: 'Скруглённые' },
  { id: 'circle', label: 'Круг' },
  { id: 'leaf', label: 'Лепесток' },
]

type Mode = 'preset' | 'custom'
const mode = ref<Mode>('preset')

const state = reactive({
  style: 'mono',
  layout: '2x2',
  dot: 'square' as 'square' | 'rounded' | 'circle' | 'classy',
  corner: 'square' as 'square' | 'rounded' | 'circle' | 'leaf',
  fg: '#3a2010',
  bg: '#fbf6f0',
  useGradient: false,
  gFrom: '#9c7440',
  gTo: '#b85c5c',
  gAngle: 45,
})

const logoFile = ref<File | null>(null)
const logoPreview = ref<string | null>(null)
const existingLogoPath = ref<string | null>(null)
const logoRemove = ref(false)
const saving = ref(false)

function close() {
  emit('update:open', false)
}

// Load saved settings when the modal opens.
watch(
  () => props.open,
  async (v) => {
    if (!v)
      return
    try {
      const res = await $fetch<{ settings: any }>(
        `/api/admin/qr-settings/${props.eventId}`,
      )
      const s = res.settings ?? {}
      if (s.style)
        state.style = s.style
      if (s.layout)
        state.layout = s.layout
      if (s.dot)
        state.dot = s.dot
      if (s.corner)
        state.corner = s.corner
      if (s.fg)
        state.fg = s.fg
      if (s.bg)
        state.bg = s.bg
      if (s.gradient) {
        state.useGradient = true
        state.gFrom = s.gradient.from
        state.gTo = s.gradient.to
        state.gAngle = s.gradient.angle ?? 45
      }
      else {
        state.useGradient = false
      }
      existingLogoPath.value = s.logo_path ?? null
      // If existing logo, fetch a public URL to show in preview slot
      logoPreview.value = s.logo_path
        ? `${useRuntimeConfig().public.siteUrl}/storage/v1/object/public/branding/${s.logo_path}`
        : null
      // Determine the tab: if any custom field is set, switch to custom.
      mode.value = (s.fg && s.fg !== '#3a2010') || s.gradient || (s.dot && s.dot !== 'square')
        ? 'custom'
        : 'preset'
    }
    catch {
      // first time — defaults are fine
    }
  },
)

const previewUrl = computed(() => {
  const params = new URLSearchParams()
  params.set('text', `https://memour.uz/uz/e/${props.eventId}?t=1`)
  if (mode.value === 'preset') {
    params.set('style', state.style)
  }
  else {
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
  return `/api/admin/qr-preview?${params.toString()}`
})

const perPage = computed(() => ({
  '2x2': 4,
  '4x2': 8,
  'single': 1,
}[state.layout] ?? 4))
const totalPages = computed(() => {
  const total = props.tableCount ?? 0
  if (!total)
    return 0
  return Math.ceil(total / perPage.value)
})
const pageSummary = computed(() => {
  if (!props.tableCount)
    return ''
  const last = props.tableCount % perPage.value
  if (last === 0 || totalPages.value === 1)
    return ''
  return `Последняя страница: ${last} QR`
})

const downloadUrl = computed(() => {
  const params = new URLSearchParams()
  if (mode.value === 'preset') {
    params.set('style', state.style)
  }
  else {
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
  params.set('layout', state.layout)
  return `/api/admin/qr-pdf/${props.eventId}?${params.toString()}`
})

function onLogoChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file)
    return
  logoFile.value = file
  logoRemove.value = false
  if (logoPreview.value?.startsWith('blob:'))
    URL.revokeObjectURL(logoPreview.value)
  logoPreview.value = URL.createObjectURL(file)
}

function removeLogo() {
  if (logoPreview.value?.startsWith('blob:'))
    URL.revokeObjectURL(logoPreview.value)
  logoPreview.value = null
  logoFile.value = null
  logoRemove.value = !!existingLogoPath.value
}

async function save() {
  saving.value = true
  try {
    const settings: any = {
      style: mode.value === 'preset' ? state.style : 'custom',
      layout: state.layout,
    }
    if (mode.value === 'custom') {
      settings.dot = state.dot
      settings.corner = state.corner
      settings.fg = state.fg
      settings.bg = state.bg
      if (state.useGradient) {
        settings.gradient = { from: state.gFrom, to: state.gTo, angle: state.gAngle }
      }
      else {
        settings.gradient = null
      }
    }
    const fd = new FormData()
    fd.append('settings', JSON.stringify(settings))
    if (logoFile.value)
      fd.append('logo', logoFile.value)
    if (logoRemove.value)
      fd.append('logo_remove', '1')
    await $fetch(`/api/admin/qr-settings/${props.eventId}`, {
      method: 'POST',
      body: fd,
    })
    toast.success('Настройки QR сохранены')
    logoFile.value = null
    logoRemove.value = false
  }
  catch (e: any) {
    toast.error('Не удалось сохранить настройки')
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <AnimatePresence>
      <motion.div
        v-if="open"
        :initial="{ opacity: 0 }"
        :animate="{ opacity: 1 }"
        :exit="{ opacity: 0 }"
        :transition="{ duration: 0.18 }"
        class="fixed inset-0 z-[180] grid place-items-center bg-black/40 p-4 backdrop-blur-sm overflow-y-auto"
        @click.self="close"
        @keydown.esc="close"
      >
        <motion.div
          :initial="{ opacity: 0, scale: 0.95, y: 16 }"
          :animate="{ opacity: 1, scale: 1, y: 0 }"
          :exit="{ opacity: 0, scale: 0.97, y: 8 }"
          :transition="{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }"
          class="surface-card relative my-8 w-full max-w-4xl overflow-hidden rounded-(--radius-xl) shadow-(--shadow-glow)"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            class="absolute right-4 top-4 z-10 grid h-8 w-8 place-items-center rounded-full border border-(--color-border) bg-white text-(--color-muted-foreground) hover:text-(--color-foreground)"
            @click="close"
          >
            <X class="h-4 w-4" :stroke-width="2" />
          </button>

          <div class="grid grid-cols-1 md:grid-cols-[1fr_1.4fr]">
            <!-- Preview -->
            <div class="border-b border-(--color-border) bg-(--color-muted)/20 p-8 md:border-b-0 md:border-r">
              <p class="text-[10px] uppercase tracking-[0.3em] text-(--color-muted-foreground)">
                Превью
              </p>
              <p class="mt-1 font-display text-lg italic">
                {{ couple }}
              </p>
              <div class="relative mt-5 grid place-items-center rounded-(--radius-xl) bg-white p-5 shadow-sm">
                <img :src="previewUrl" alt="preview" class="h-auto w-full max-w-[260px]">
                <!-- Logo overlay simulation (centered on top of SVG) -->
                <img
                  v-if="logoPreview"
                  :src="logoPreview"
                  alt="logo"
                  class="pointer-events-none absolute inset-0 m-auto rounded-md"
                  style="width: 22%; height: 22%; object-fit: contain; padding: 2%"
                >
              </div>
              <p class="mt-3 text-center text-xs text-(--color-muted-foreground)">
                Стол 1 · ссылка для гостей
              </p>
            </div>

            <!-- Options -->
            <div class="flex max-h-[80vh] flex-col gap-6 overflow-y-auto p-6 sm:p-8">
              <div>
                <h2 class="heading-display-md" style="font-size: 1.5rem;">
                  QR PDF
                </h2>
                <p class="mt-1 text-sm text-(--color-muted-foreground)">
                  Настройки сохраняются на это событие
                </p>
              </div>

              <!-- Mode tabs -->
              <div class="flex gap-1 rounded-full border border-(--color-border) bg-white p-0.5">
                <button
                  v-for="m in ['preset', 'custom'] as Mode[]"
                  :key="m"
                  type="button"
                  class="flex-1 rounded-full px-3 py-1.5 text-xs transition-colors" :class="[
                    mode === m
                      ? 'bg-(--color-primary) text-(--color-primary-foreground)'
                      : 'text-(--color-muted-foreground) hover:text-(--color-foreground)',
                  ]"
                  @click="mode = m"
                >
                  {{ m === 'preset' ? 'Готовые стили' : 'Свой стиль' }}
                </button>
              </div>

              <!-- Preset mode -->
              <template v-if="mode === 'preset'">
                <div>
                  <p class="mb-2 text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">
                    Стиль кода
                  </p>
                  <div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    <button
                      v-for="p in PRESETS"
                      :key="p.id"
                      type="button"
                      class="flex flex-col items-center gap-1.5 rounded-md border bg-white p-2 transition-all" :class="[
                        state.style === p.id
                          ? 'border-(--color-primary) ring-2 ring-(--color-primary)/40'
                          : 'border-(--color-border) hover:border-(--color-primary)/40',
                      ]"
                      @click="state.style = p.id"
                    >
                      <img
                        :src="`/api/admin/qr-preview?style=${p.id}&text=preview`"
                        :alt="p.label"
                        class="aspect-square w-full"
                      >
                      <span class="text-[10px] text-(--color-foreground)">{{ p.label }}</span>
                    </button>
                  </div>
                </div>
              </template>

              <!-- Custom mode -->
              <template v-else>
                <div class="grid gap-3 sm:grid-cols-2">
                  <div class="flex flex-col gap-1">
                    <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">Точки</label>
                    <select
                      v-model="state.dot"
                      class="h-10 rounded-md border border-(--color-border) bg-white px-3 text-sm"
                    >
                      <option v-for="d in DOTS" :key="d.id" :value="d.id">
                        {{ d.label }}
                      </option>
                    </select>
                  </div>
                  <div class="flex flex-col gap-1">
                    <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">Углы</label>
                    <select
                      v-model="state.corner"
                      class="h-10 rounded-md border border-(--color-border) bg-white px-3 text-sm"
                    >
                      <option v-for="c in CORNERS" :key="c.id" :value="c.id">
                        {{ c.label }}
                      </option>
                    </select>
                  </div>
                </div>

                <div class="grid gap-3 sm:grid-cols-2">
                  <div class="flex flex-col gap-1">
                    <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">Цвет кода</label>
                    <div class="flex items-center gap-2">
                      <input v-model="state.fg" type="color" class="h-10 w-12 cursor-pointer rounded-md border border-(--color-border) bg-white p-1">
                      <input v-model="state.fg" type="text" pattern="^#[0-9a-fA-F]{6}$" class="h-10 flex-1 rounded-md border border-(--color-border) bg-white px-3 font-mono text-xs">
                    </div>
                  </div>
                  <div class="flex flex-col gap-1">
                    <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">Цвет фона</label>
                    <div class="flex items-center gap-2">
                      <input v-model="state.bg" type="color" class="h-10 w-12 cursor-pointer rounded-md border border-(--color-border) bg-white p-1">
                      <input v-model="state.bg" type="text" pattern="^#[0-9a-fA-F]{6}$" class="h-10 flex-1 rounded-md border border-(--color-border) bg-white px-3 font-mono text-xs">
                    </div>
                  </div>
                </div>

                <div>
                  <label class="flex cursor-pointer items-center gap-2 text-sm">
                    <input v-model="state.useGradient" type="checkbox" class="h-4 w-4 rounded border-(--color-border) accent-(--color-primary)">
                    <span>Градиент вместо сплошного цвета</span>
                  </label>
                  <div v-if="state.useGradient" class="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                    <div class="flex flex-col gap-1">
                      <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">Цвет 1</label>
                      <input v-model="state.gFrom" type="color" class="h-10 w-full cursor-pointer rounded-md border border-(--color-border) bg-white p-1">
                    </div>
                    <div class="flex flex-col gap-1">
                      <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">Цвет 2</label>
                      <input v-model="state.gTo" type="color" class="h-10 w-full cursor-pointer rounded-md border border-(--color-border) bg-white p-1">
                    </div>
                    <div class="flex flex-col gap-1">
                      <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">Угол</label>
                      <input v-model.number="state.gAngle" type="number" min="0" max="360" class="h-10 w-20 rounded-md border border-(--color-border) bg-white px-2 text-center text-sm">
                    </div>
                  </div>
                </div>
              </template>

              <!-- Logo -->
              <div>
                <p class="mb-2 text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">
                  Логотип в центре (опционально)
                </p>
                <div class="flex items-center gap-3">
                  <label class="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-(--color-border) bg-white px-4 text-sm hover:bg-(--color-muted)">
                    <Upload class="h-4 w-4" :stroke-width="1.6" />
                    {{ logoPreview ? 'Сменить' : 'Загрузить' }}
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" class="hidden" @change="onLogoChange">
                  </label>
                  <button
                    v-if="logoPreview"
                    type="button"
                    class="inline-flex h-10 items-center gap-2 rounded-md border border-(--color-border) bg-white px-4 text-sm text-red-700 hover:bg-red-50"
                    @click="removeLogo"
                  >
                    <Trash2 class="h-4 w-4" :stroke-width="1.6" />
                    Убрать
                  </button>
                </div>
                <p class="mt-2 text-[11px] text-(--color-muted-foreground)">
                  PNG / JPEG / WebP / SVG. Размер не более 4 МБ. Логотип займёт ~22% центра — QR остаётся читаемым.
                </p>
              </div>

              <!-- Layout -->
              <div>
                <p class="mb-2 text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">
                  Раскладка PDF
                </p>
                <p v-if="tableCount" class="mb-2 text-[11px] text-(--color-muted-foreground)">
                  У события {{ tableCount }} {{ tableCount === 1 ? 'стол' : tableCount < 5 ? 'стола' : 'столов' }} —
                  получится <strong class="text-(--color-foreground)">{{ totalPages }}</strong>
                  {{ totalPages === 1 ? 'страница' : totalPages < 5 ? 'страницы' : 'страниц' }} A4.
                  <template v-if="pageSummary">
                    {{ pageSummary }}.
                  </template>
                </p>
                <div class="grid gap-2">
                  <button
                    v-for="l in LAYOUTS"
                    :key="l.id"
                    type="button"
                    class="flex items-center justify-between rounded-md border bg-white px-4 py-3 text-left transition-colors" :class="[
                      state.layout === l.id
                        ? 'border-(--color-primary) ring-2 ring-(--color-primary)/40'
                        : 'border-(--color-border) hover:border-(--color-primary)/40',
                    ]"
                    @click="state.layout = l.id"
                  >
                    <div>
                      <p class="text-sm font-medium">
                        {{ l.label }}
                      </p>
                      <p class="text-xs text-(--color-muted-foreground)">
                        {{ l.desc }}
                      </p>
                    </div>
                    <span
                      class="grid h-5 w-5 place-items-center rounded-full border-2" :class="[
                        state.layout === l.id
                          ? 'border-(--color-primary) bg-(--color-primary)'
                          : 'border-(--color-border)',
                      ]"
                    >
                      <span v-if="state.layout === l.id" class="h-2 w-2 rounded-full bg-white" />
                    </span>
                  </button>
                </div>
              </div>

              <!-- Actions -->
              <div class="mt-auto flex gap-2">
                <button
                  type="button"
                  :disabled="saving"
                  class="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md border border-(--color-border) bg-white text-sm hover:bg-(--color-muted) disabled:opacity-60"
                  @click="save"
                >
                  <Save class="h-4 w-4" :stroke-width="1.8" />
                  {{ saving ? 'Сохраняем…' : 'Сохранить' }}
                </button>
                <a
                  :href="downloadUrl"
                  target="_blank"
                  rel="noopener"
                  class="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-(--color-primary) px-5 text-sm font-medium text-(--color-primary-foreground) hover:opacity-95"
                >
                  <Download class="h-4 w-4" :stroke-width="1.8" />
                  Скачать PDF
                </a>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  </Teleport>
</template>
