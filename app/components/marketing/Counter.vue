<script setup lang="ts">
import { useIntersectionObserver } from '@vueuse/core'
import { onBeforeUnmount, ref } from 'vue'

/**
 * Counter — RAF-based tween from 0 to `to` once the element enters the
 * viewport. Suffix sits on its own step-down display line so long
 * Uzbek modifiers ("tagacha"/"soniyalik"/"oygacha") don't get clipped
 * by the column width on 2K/4K monitors.
 */
const props = defineProps<{
  to: number
  suffix?: string
  prefix?: string
}>()

const el = ref<HTMLElement | null>(null)
const n = ref(0)
let rafId = 0

const { stop } = useIntersectionObserver(el, ([entry]) => {
  if (!entry?.isIntersecting)
    return
  stop()
  const startedAt = performance.now()
  const duration = 1600
  const tick = (now: number) => {
    const t = Math.min(1, (now - startedAt) / duration)
    const eased = 1 - (1 - t) ** 3
    n.value = Math.round(props.to * eased)
    if (t < 1)
      rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)
}, { threshold: 0.5 })

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId)
})

function formatRu(num: number) {
  return num.toLocaleString('ru-RU')
}
</script>

<template>
  <span ref="el" class="block">
    <span
      class="block font-display text-gradient-gold text-4xl sm:text-5xl md:text-6xl xl:text-7xl 2xl:text-8xl 3xl:text-[7rem] 4xl:text-[9rem]"
    >{{ prefix }}{{ formatRu(n) }}</span>
    <span
      v-if="suffix && suffix.trim()"
      class="mt-1 block font-display text-2xl text-(--color-foreground)/85 sm:text-3xl md:text-4xl xl:text-5xl 2xl:text-[3.25rem] 3xl:text-[4rem] 4xl:text-[5rem]"
    >{{ suffix.trim() }}</span>
  </span>
</template>
