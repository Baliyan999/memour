<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '#imports'

/**
 * One consent checkbox: never pre-ticked, the whole row is the tap
 * target, and the document it refers to opens in a new tab so nothing
 * typed into the form is lost.
 *
 * `keypath` is a message with a {link} slot, e.g.
 *   "Даю согласие … по {link}."  +  linkText "Политике конфиденциальности"
 * and optional other `params` ({date} …). The server records what was
 * ticked (server/utils/consent.ts).
 */
const props = defineProps<{
  id: string
  keypath: string
  linkText: string
  to: string
  params?: Record<string, string>
  invalid?: boolean
  describedby?: string
}>()
const model = defineModel<boolean>({ required: true })

const { t } = useI18n()
const MARK = '\u0001'
const parts = computed(() => {
  const [before = '', after = ''] = t(props.keypath, { ...props.params, link: MARK }).split(MARK)
  return { before, after }
})
</script>

<template>
  <div class="flex items-start gap-3">
    <input
      :id="id"
      v-model="model"
      type="checkbox"
      :aria-invalid="invalid ? 'true' : undefined"
      :aria-describedby="describedby"
      :class="[
        'mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border accent-(--color-primary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring) focus-visible:ring-offset-2',
        invalid ? 'border-red-500 ring-2 ring-red-200' : 'border-(--color-border)',
      ]"
    >
    <label :for="id" class="min-h-6 cursor-pointer text-left text-xs leading-relaxed text-(--color-muted-foreground)">
      {{ parts.before }}<a
        :href="to"
        target="_blank"
        rel="noopener"
        class="text-(--color-foreground) underline decoration-(--color-primary)/50 underline-offset-2 hover:decoration-(--color-primary)"
      >{{ linkText }}</a>{{ parts.after }}
    </label>
  </div>
</template>
