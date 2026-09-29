<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '#imports'

/**
 * SoonBadge — a label for a feature that isn't live yet, with a small
 * muted «скоро» / «tez orada» pill after it. The pill is glued to the
 * label's last word, so a wrapping line never leaves it alone at the
 * start of a row. It is drawn in the text colour it sits in (a
 * hairline ring and a dimmed fill of `currentColor`), so the same pill
 * reads on the light cards and on the dark Luxury card. It is set in
 * the sans like the site's other small caps, even inside a serif
 * title, and its size follows the text around it within a small range
 * (10px at least, and only lightly dimmed, so it stays legible).
 * Screen readers hear «(появится скоро)» in place of the pill.
 */
const props = defineProps<{ text: string }>()

const { t } = useI18n()

// Split at the last space: everything before it wraps freely.
const parts = computed(() => {
  const at = props.text.lastIndexOf(' ')
  return at < 0 ? { head: '', tail: props.text } : { head: props.text.slice(0, at + 1), tail: props.text.slice(at + 1) }
})
</script>

<template>
  <span>{{ parts.head }}<span class="whitespace-nowrap">{{ parts.tail }}<span
    aria-hidden="true"
    class="ml-[0.5em] inline-block rounded-full bg-current/[0.06] px-[0.6em] align-[0.12em] font-sans text-[length:clamp(10px,0.5em,12px)] font-medium uppercase leading-[1.6] tracking-[0.14em] opacity-80 ring-1 ring-current/35 ring-inset"
  >{{ t('pricing.soon') }}</span></span><span class="sr-only"> {{ t('pricing.soonSr') }}</span></span>
</template>
