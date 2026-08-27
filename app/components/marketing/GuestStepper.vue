<script setup lang="ts">
import { ChevronDown, ChevronUp } from '@lucide/vue'
import { ref, watch } from 'vue'

/**
 * GuestStepper — number input with brand-styled +/- buttons stacked
 * on the right edge. Digits only, capped at 4 chars (9999 is already
 * absurd for a wedding). Hides native spinners via Tailwind arbitrary
 * CSS so the field stays clean across browsers.
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
  if (cleaned !== t.value)
    t.value = cleaned
  local.value = cleaned
  emitParsed()
}

function bump(direction: 1 | -1) {
  const current = local.value === '' ? null : Number(local.value)
  const next = current == null || !Number.isFinite(current)
    ? (direction === 1 ? props.min : props.max)
    : current + direction * props.step
  const clamped = Math.min(props.max, Math.max(props.min, next))
  local.value = String(clamped)
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
      pattern="[0-9]*"
      :maxlength="4"
      :value="local"
      class="flex h-11 w-full rounded-md border border-(--color-border) bg-white px-3 py-2 pr-8 text-sm placeholder:text-(--color-muted-foreground) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring) 3xl:h-12 3xl:text-base 4xl:h-14 4xl:px-4 4xl:text-lg"
      @input="onInput"
    >
    <div class="pointer-events-none absolute inset-y-2 right-2 flex w-5 flex-col">
      <button
        type="button"
        aria-label="+1"
        class="pointer-events-auto flex flex-1 items-center justify-center rounded-t-sm text-(--color-muted-foreground) transition-colors hover:bg-(--color-accent)/50 hover:text-(--color-primary)"
        @click="bump(1)"
      >
        <ChevronUp class="h-3 w-3" :stroke-width="2" />
      </button>
      <button
        type="button"
        aria-label="-1"
        class="pointer-events-auto flex flex-1 items-center justify-center rounded-b-sm text-(--color-muted-foreground) transition-colors hover:bg-(--color-accent)/50 hover:text-(--color-primary)"
        @click="bump(-1)"
      >
        <ChevronDown class="h-3 w-3" :stroke-width="2" />
      </button>
    </div>
  </div>
</template>
