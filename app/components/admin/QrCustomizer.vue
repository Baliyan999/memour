<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { motion, AnimatePresence } from 'motion-v'
import { Download, X } from '@lucide/vue'

/**
 * Modal that lets the admin pick a QR style preset + page layout
 * before downloading the printable PDF. Live SVG preview updates
 * as the choices change.
 *
 *   v-model:open — show/hide
 *   eventId — UUID of the event whose PDF we generate
 */
const props = defineProps<{
  open: boolean
  eventId: string
  couple: string
}>()
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
}>()

const PRESETS = [
  { id: 'mono', label: 'Классика' },
  { id: 'rounded', label: 'Скруглённый' },
  { id: 'dots', label: 'Точки' },
  { id: 'classy', label: 'Бусины' },
  { id: 'leaf', label: 'Лепесток' },
  { id: 'gold', label: 'Золото' },
  { id: 'rose', label: 'Роза' },
  { id: 'midnight', label: 'Полночь' },
]
const LAYOUTS = [
  { id: '2x2', label: '4 на лист', desc: 'A4, 2×2 — стандарт' },
  { id: '4x2', label: '8 на лист', desc: 'A4, 4×2 — компактнее' },
  { id: 'single', label: '1 на лист', desc: 'A4, крупный QR на всю страницу' },
]

const style = ref('mono')
const layout = ref('2x2')

function close() {
  emit('update:open', false)
}

const previewUrl = computed(() => {
  const text = `https://memour.uz/uz/e/${props.eventId}?t=1`
  return `/api/admin/qr-preview?style=${style.value}&text=${encodeURIComponent(text)}`
})

const downloadUrl = computed(
  () => `/api/admin/qr-pdf/${props.eventId}?style=${style.value}&layout=${layout.value}`,
)
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
        class="fixed inset-0 z-[180] grid place-items-center bg-black/40 p-4 backdrop-blur-sm"
        @click.self="close"
        @keydown.esc="close"
      >
        <motion.div
          :initial="{ opacity: 0, scale: 0.95, y: 16 }"
          :animate="{ opacity: 1, scale: 1, y: 0 }"
          :exit="{ opacity: 0, scale: 0.97, y: 8 }"
          :transition="{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }"
          class="surface-card relative w-full max-w-4xl overflow-hidden rounded-(--radius-xl) shadow-(--shadow-glow)"
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
            <!-- Preview pane -->
            <div class="border-b border-(--color-border) bg-(--color-muted)/20 p-8 md:border-b-0 md:border-r">
              <p class="text-[10px] uppercase tracking-[0.3em] text-(--color-muted-foreground)">
                Превью
              </p>
              <p class="mt-1 font-display text-lg italic">{{ couple }}</p>
              <div class="mt-5 grid place-items-center rounded-(--radius-xl) bg-white p-5 shadow-sm">
                <img
                  :src="previewUrl"
                  alt="preview"
                  class="h-auto w-full max-w-[260px]"
                >
              </div>
              <p class="mt-3 text-center text-xs text-(--color-muted-foreground)">
                Стол 1 · ссылка для гостей
              </p>
            </div>

            <!-- Options -->
            <div class="flex flex-col gap-6 p-6 sm:p-8">
              <div>
                <h2 class="heading-display-md" style="font-size: 1.5rem;">QR PDF</h2>
                <p class="mt-1 text-sm text-(--color-muted-foreground)">
                  Настройте стиль кодов и формат листа
                </p>
              </div>

              <div>
                <p class="mb-2 text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">Стиль кода</p>
                <div class="grid grid-cols-4 gap-2">
                  <button
                    v-for="p in PRESETS"
                    :key="p.id"
                    type="button"
                    :class="[
                      'flex flex-col items-center gap-1.5 rounded-md border bg-white p-2 transition-all',
                      style === p.id
                        ? 'border-(--color-primary) ring-2 ring-(--color-primary)/40'
                        : 'border-(--color-border) hover:border-(--color-primary)/40',
                    ]"
                    @click="style = p.id"
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

              <div>
                <p class="mb-2 text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">Раскладка</p>
                <div class="grid gap-2">
                  <button
                    v-for="l in LAYOUTS"
                    :key="l.id"
                    type="button"
                    :class="[
                      'flex items-center justify-between rounded-md border bg-white px-4 py-3 text-left transition-colors',
                      layout === l.id
                        ? 'border-(--color-primary) ring-2 ring-(--color-primary)/40'
                        : 'border-(--color-border) hover:border-(--color-primary)/40',
                    ]"
                    @click="layout = l.id"
                  >
                    <div>
                      <p class="text-sm font-medium">{{ l.label }}</p>
                      <p class="text-xs text-(--color-muted-foreground)">{{ l.desc }}</p>
                    </div>
                    <span
                      :class="[
                        'grid h-5 w-5 place-items-center rounded-full border-2',
                        layout === l.id
                          ? 'border-(--color-primary) bg-(--color-primary)'
                          : 'border-(--color-border)',
                      ]"
                    >
                      <span v-if="layout === l.id" class="h-2 w-2 rounded-full bg-white" />
                    </span>
                  </button>
                </div>
              </div>

              <a
                :href="downloadUrl"
                target="_blank"
                rel="noopener"
                class="mt-auto inline-flex h-12 items-center justify-center gap-2 rounded-md bg-(--color-primary) px-5 text-sm font-medium text-(--color-primary-foreground) hover:opacity-95"
              >
                <Download class="h-4 w-4" :stroke-width="1.8" />
                Скачать PDF
              </a>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  </Teleport>
</template>
