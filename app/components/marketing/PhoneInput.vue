<script setup lang="ts">
import { ref, computed, watch } from 'vue'

/**
 * PhoneInput — masked Uzbekistan number. The "+998 " prefix is always
 * visible (never erasable) and only digits are accepted past it, up to
 * 9 user digits. As the user types, the field formats live as
 * "+998 XX XXX XX XX". Backspace / Delete are blocked from chewing
 * into the prefix.
 *
 * No `required` / `pattern`: the prefix always "fills" the field, and a
 * pattern mismatch shows the browser's bubble in the browser's
 * language. The form checks `digits` (9 of them) and says what's wrong
 * in the site's language.
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
  if (d.length === 0) return '+998 '
  let s = '+998 ' + d.slice(0, 2)
  if (d.length > 2) s += ' ' + d.slice(2, 5)
  if (d.length > 5) s += ' ' + d.slice(5, 7)
  if (d.length > 7) s += ' ' + d.slice(7, 9)
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

// A parent that sets `digits` after mount (prefill once data arrives,
// a reset) still shows it.
watch(() => props.digits, (d) => {
  if ((d ?? '') !== digits.value) digits.value = d ?? ''
})

/**
 * Pull the national digits (the part after +998) out of whatever
 * ended up in the field. People paste or type numbers in every shape — "+998 90 123 45 67",
 * "998901234567", "90 123 45 67" — sometimes right after our own
 * "+998 " prefix, sometimes over a full selection. We look at the
 * whole value (not the caret position), drop our prefix if it's still
 * there, then drop the country code the user brought along. Only a
 * leading "998" on something longer than a national number, followed
 * by a digit a Uzbek number can start with (2–9), counts as a country
 * code — so "99 812 34 56" stays intact.
 *
 * Known trade-off: a complete "99 8X…" number (X = 2–9) plus one more
 * digit typed at the end looks exactly like "998" followed by a number
 * being typed from scratch, so it collapses to 7 digits. That's visible
 * and the form refuses it; the reverse (silently keeping "99 8…" when
 * "998…" was meant) sent SMS codes to a stranger's number.
 */
function nationalDigits(value: string, countryCode = true): string {
  const all = value.replace(/\D/g, '')
  let d = value.trimStart().startsWith('+998') ? all.slice(3) : all
  if (countryCode && d.length > 9 && /^998[2-9]/.test(d)) d = d.slice(3)
  return d
}

function onInput(e: Event) {
  const target = e.target as HTMLInputElement
  // A digit typed into the middle of a complete number is a slip, not
  // the start of "998…": the number stays as it was.
  const midEdit = digits.value.length === 9 && (target.selectionEnd ?? 0) < target.value.length
  const next = nationalDigits(target.value, !midEdit)
  digits.value = midEdit && next.length > 9 ? digits.value : next.slice(0, 9)

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
    try { target.setSelectionRange(caret, caret) } catch { /* noop */ }
  }
}

// A pasted full number replaces the field instead of being spliced in
// at the caret — "+998 90 1" + paste "+998 90 123 45 67" must end up as
// that number, not as a mix of both. Partial (or foreign) pastes fall
// through to onInput as usual.
function onPaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text') ?? ''
  const pasted = nationalDigits(text)
  if (pasted.length !== 9) return
  e.preventDefault()
  const target = e.currentTarget as HTMLInputElement
  digits.value = pasted
  const formatted = format(pasted)
  target.value = formatted
  try { target.setSelectionRange(formatted.length, formatted.length) } catch { /* noop */ }
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Backspace' && e.key !== 'Delete') return
  const input = e.currentTarget as HTMLInputElement
  const start = input.selectionStart ?? 0
  const end = input.selectionEnd ?? 0
  // Block deletion of the "+998 " prefix (positions 0..4).
  if (e.key === 'Backspace' && start <= 5 && end <= 5) e.preventDefault()
  if (e.key === 'Delete' && start < 5) e.preventDefault()
}
</script>

<template>
  <input
    :id="id"
    name="phone"
    type="tel"
    inputmode="numeric"
    autocomplete="tel"
    :value="display"
    class="flex h-11 w-full rounded-md border border-(--color-border) bg-white px-3 py-2 text-base sm:text-sm placeholder:text-(--color-muted-foreground)/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring) 3xl:h-12 3xl:text-base 4xl:h-14 4xl:px-4 4xl:text-lg"
    @input="onInput"
    @paste="onPaste"
    @keydown="onKeyDown"
  >
</template>
