<script setup lang="ts">
import { computed, ref, watch } from 'vue'

/**
 * PhoneInput — masked Uzbekistan number. The "+998 " prefix is always
 * visible (never erasable) and only digits are accepted past it, up to
 * 9 user digits. As the user types, the field formats live as
 * "+998 XX XXX XX XX". Backspace / Delete are blocked from chewing
 * into the prefix.
 */
const props = defineProps<{
  modelValue: string
  digits: string
  id?: string
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'update:digits', value: string): void
}>()

const digits = ref(props.digits ?? '')

function format(d: string): string {
  // Always render the +998 prefix, even when the user hasn't typed
  // anything yet. The trailing space gives the caret a place to land
  // and visually separates the prefix from the user's input.
  if (d.length === 0)
    return '+998 '
  let s = `+998 ${d.slice(0, 2)}`
  if (d.length > 2)
    s += ` ${d.slice(2, 5)}`
  if (d.length > 5)
    s += ` ${d.slice(5, 7)}`
  if (d.length > 7)
    s += ` ${d.slice(7, 9)}`
  return s
}

const display = computed(() => format(digits.value))

watch(
  digits,
  (d) => {
    emit('update:digits', d)
    emit('update:modelValue', format(d))
  },
  { immediate: true },
)

function onInput(e: Event) {
  const target = e.target as HTMLInputElement
  // Display always starts with "+998 " so the field's digit-only view
  // always begins with "998" — strip those 3 from the user portion.
  // If the user managed to delete past the prefix, reset their digits
  // to empty.
  const all = target.value.replace(/\D/g, '')
  const user = all.startsWith('998') ? all.slice(3) : ''
  digits.value = user.slice(0, 9)

  // Force-rewrite the DOM input to the formatted value. Without this,
  // Vue's :value binding only repaints when `digits` actually changes;
  // if the user typed Cyrillic letters (which strip to nothing), the
  // ref stays the same and the invalid characters remain in the DOM.
  const formatted = format(digits.value)
  if (target.value !== formatted) {
    target.value = formatted
    // Keep the caret pinned to the end of the user-entered portion
    // (rather than jumping to position 0 after the .value assignment).
    const caret = formatted.length
    try { target.setSelectionRange(caret, caret) }
    catch { /* noop */ }
  }
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Backspace' && e.key !== 'Delete')
    return
  const input = e.currentTarget as HTMLInputElement
  const start = input.selectionStart ?? 0
  const end = input.selectionEnd ?? 0
  // Block deletion of the "+998 " prefix (positions 0..4).
  if (e.key === 'Backspace' && start <= 5 && end <= 5)
    e.preventDefault()
  if (e.key === 'Delete' && start < 5)
    e.preventDefault()
}
</script>

<template>
  <input
    :id="id"
    name="phone"
    type="tel"
    inputmode="numeric"
    autocomplete="tel"
    required
    :value="display"
    pattern="\+998 \d{2} \d{3} \d{2} \d{2}"
    class="flex h-11 w-full rounded-md border border-(--color-border) bg-white px-3 py-2 text-sm placeholder:text-(--color-muted-foreground)/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring) 3xl:h-12 3xl:text-base 4xl:h-14 4xl:px-4 4xl:text-lg"
    @input="onInput"
    @keydown="onKeyDown"
  >
</template>
