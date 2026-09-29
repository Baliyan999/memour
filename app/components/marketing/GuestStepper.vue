<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from '#imports'
import { Minus, Plus } from '@lucide/vue'

/**
 * GuestStepper — number input with brand-styled −/+ buttons on the
 * right edge (32px targets, WCAG 2.5.8). Digits only, capped at 4
 * chars; a typed value outside [min, max] is pulled back into range on
 * blur, so the form never sends a number the server rejects. Hides
 * native spinners via Tailwind arbitrary CSS so the field stays clean
 * across browsers.
 */
const props = withDefaults(
  defineProps<{
    modelValue: number | null
    id?: string
    min?: number
    max?: number
    step?: number
  }>(),
  { min: 10, max: 1000, step: 1 },
)
const emit = defineEmits<{
  (e: 'update:modelValue', v: number | null): void
}>()

const { t } = useI18n()
const local = ref(props.modelValue == null ? '' : String(props.modelValue))

watch(() => props.modelValue, (v) => {
  local.value = v == null ? '' : String(v)
})

function emitParsed() {
  const n = local.value === '' ? null : Number(local.value)
  emit('update:modelValue', n == null || !Number.isFinite(n) ? null : n)
}

function onInput(e: Event) {
  const t = e.target as HTMLInputElement
  const cleaned = t.value.replace(/\D/g, '').slice(0, 4)
  if (cleaned !== t.value) t.value = cleaned
  local.value = cleaned
  emitParsed()
}

function clamp(n: number) {
  return Math.min(props.max, Math.max(props.min, n))
}

function bump(direction: 1 | -1) {
  const current = local.value === '' ? null : Number(local.value)
  // An empty field starts at the minimum either way — "−" on an empty
  // field used to jump to the maximum.
  const next = current == null || !Number.isFinite(current)
    ? props.min
    : current + direction * props.step
  local.value = String(clamp(next))
  emitParsed()
}

// Also on Enter: implicit form submission doesn't blur the field first.
function onBlur() {
  if (local.value === '') return
  const n = Number(local.value)
  if (!Number.isFinite(n) || n === clamp(n)) return
  local.value = String(clamp(n))
  emitParsed()
}
</script>

<template>
  <div class="relative">
    <input
      :id="id"
      name="guests"
      type="text"
      inputmode="numeric"
      :maxlength="4"
      :value="local"
      class="flex h-11 w-full rounded-md border border-(--color-border) bg-white px-3 py-2 pr-[4.5rem] text-base placeholder:text-(--color-muted-foreground) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring) sm:text-sm 3xl:h-12 3xl:text-base 4xl:h-14 4xl:px-4 4xl:text-lg"
      @input="onInput"
      @blur="onBlur"
      @keydown.enter="onBlur"
    >
    <div class="pointer-events-none absolute inset-y-0 right-1.5 flex items-center gap-0.5">
      <button
        type="button"
        :aria-label="t('common.decrease')"
        class="press pointer-events-auto grid h-8 w-8 place-items-center rounded-md text-(--color-muted-foreground) hover:bg-(--color-accent)/50 hover:text-(--color-primary)"
        @click="bump(-1)"
      >
        <Minus class="h-3.5 w-3.5" :stroke-width="2" aria-hidden="true" />
      </button>
      <button
        type="button"
        :aria-label="t('common.increase')"
        class="press pointer-events-auto grid h-8 w-8 place-items-center rounded-md text-(--color-muted-foreground) hover:bg-(--color-accent)/50 hover:text-(--color-primary)"
        @click="bump(1)"
      >
        <Plus class="h-3.5 w-3.5" :stroke-width="2" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
