<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useI18n } from '#imports'
import {
  addMonths,
  startOfMonth,
  startOfWeek,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isBefore,
  isAfter,
  startOfDay,
  addDays,
} from 'date-fns'
import { ru, uz } from 'date-fns/locale'
import { Calendar, ChevronLeft, ChevronRight } from '@lucide/vue'

/**
 * DatePicker — locale-aware popup calendar matching the brand. Mirrors
 * the Next.js implementation: custom trigger button, popup rendered
 * via a Teleport to <body> (escaping any ancestor's overflow), Mon-Sun
 * grid built with date-fns, ru/uz month/weekday names. Min date is
 * today; max date is today + 3 years.
 *
 * Keyboard: opening moves focus to the selected (or today's) day;
 * arrows move by day/week, PageUp/PageDown by month, Enter picks, the
 * month arrows carry the focusable day along. Esc, or tabbing out past
 * either end of the popup, closes it and hands focus back to the
 * trigger. The `id` lands on the trigger so an outside <label for>
 * names it.
 */
const props = defineProps<{
  modelValue: string | null
  id?: string
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: string | null): void
}>()

const { t, locale } = useI18n()
const dfLocale = computed(() => (locale.value === 'uz' ? uz : ru))

const today = startOfDay(new Date())
const maxDate = new Date(today.getFullYear() + 3, 11, 31)

const selected = ref<Date | null>(props.modelValue ? new Date(props.modelValue) : null)
const open = ref(false)
const cursor = ref(startOfMonth(selected.value ?? today))

const triggerEl = ref<HTMLButtonElement | null>(null)
const popupEl = ref<HTMLDivElement | null>(null)
// Day that holds the roving tabindex / receives keyboard focus.
const focused = ref<Date>(selected.value ?? today)
const pos = ref<{ top: number; left: number; placement: 'above' | 'below' } | null>(null)

const mounted = ref(false)
onMounted(() => { mounted.value = true })

// Selected date emitted as YYYY-MM-DD for form payload compatibility.
function emitSelected(d: Date | null) {
  selected.value = d
  if (!d) {
    emit('update:modelValue', null)
    return
  }
  emit('update:modelValue', format(d, 'yyyy-MM-dd'))
}

const triggerLabel = computed(() => {
  if (!selected.value) return locale.value === 'uz' ? 'KK.OO.YYYY' : 'ДД.ММ.ГГГГ'
  return format(selected.value, 'dd.MM.yyyy')
})

// 6×7 grid of days for the current cursor month (rounded to whole weeks).
const days = computed(() => {
  const monthStart = startOfMonth(cursor.value)
  const monthEnd = endOfMonth(cursor.value)
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })
  const list: Date[] = []
  let d = gridStart
  while (!isAfter(d, gridEnd)) {
    list.push(d)
    d = addDays(d, 1)
  }
  return list
})

const weekDayLabels = computed(() => {
  // Mon..Sun, two-letter, lowercased — matches the original layout.
  const base = startOfWeek(new Date(), { weekStartsOn: 1 })
  return Array.from({ length: 7 }, (_, i) =>
    format(addDays(base, i), 'EEEEEE', { locale: dfLocale.value }),
  )
})

const monthCaption = computed(() =>
  format(cursor.value, 'LLLL yyyy', { locale: dfLocale.value }),
)

function isDisabled(d: Date) {
  return isBefore(d, today) || isAfter(d, maxDate)
}

function pickDay(d: Date) {
  if (isDisabled(d)) return
  emitSelected(d)
  close()
}

function close() {
  open.value = false
  triggerEl.value?.focus()
}

function focusDay(d: Date) {
  const clamped = isBefore(d, today) ? today : isAfter(d, maxDate) ? maxDate : d
  focused.value = clamped
  if (!isSameMonth(clamped, cursor.value)) cursor.value = startOfMonth(clamped)
  nextTick(() => popupEl.value?.querySelector<HTMLButtonElement>('[data-focused="true"]')?.focus())
}

const KEY_STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
function onGridKey(e: KeyboardEvent) {
  if (e.key in KEY_STEPS) {
    e.preventDefault()
    focusDay(addDays(focused.value, KEY_STEPS[e.key]!))
  } else if (e.key === 'PageUp' || e.key === 'PageDown') {
    e.preventDefault()
    focusDay(addMonths(focused.value, e.key === 'PageUp' ? -1 : 1))
  }
}

// The popup is teleported to the end of <body>: tabbing out of it would
// land past the footer. Leaving it from either end closes it instead and
// continues from the trigger.
function onPopupKey(e: KeyboardEvent) {
  if (e.key !== 'Tab' || !popupEl.value) return
  const stops = Array.from(popupEl.value.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"])'))
  const edge = e.shiftKey ? stops[0] : stops.at(-1)
  if (!edge || document.activeElement === edge) {
    e.preventDefault()
    close()
  }
}

const dayLabel = (d: Date) => format(d, 'd MMMM yyyy', { locale: dfLocale.value })

// Month arrows stay within today…maxDate and move the focusable day
// along (same day of the month, clamped), so the grid always keeps one
// tab stop.
const firstMonth = startOfMonth(today)
const lastMonth = startOfMonth(maxDate)
const canPrev = computed(() => isAfter(cursor.value, firstMonth))
const canNext = computed(() => isBefore(cursor.value, lastMonth))
function shiftMonth(delta: number) {
  if (delta < 0 ? !canPrev.value : !canNext.value) return
  const month = addMonths(cursor.value, delta)
  cursor.value = month
  const day = new Date(month.getFullYear(), month.getMonth(), Math.min(focused.value.getDate(), endOfMonth(month).getDate()))
  focused.value = isBefore(day, today) ? today : isAfter(day, maxDate) ? maxDate : day
}
function prevMonth() { shiftMonth(-1) }
function nextMonthFn() { shiftMonth(1) }

// Position popup relative to the trigger via getBoundingClientRect.
// Position: fixed + teleport to body means no ancestor overflow can
// clip the popup. Prefer opening upward, fall back to below when the
// top doesn't have enough room.
function measure() {
  const trigger = triggerEl.value
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  const popupHeight = 320
  const spaceAbove = rect.top
  const spaceBelow = window.innerHeight - rect.bottom
  const placement = spaceAbove >= popupHeight || spaceAbove >= spaceBelow ? 'above' : 'below'
  pos.value = {
    top: placement === 'above' ? rect.top - 6 : rect.bottom + 6,
    left: rect.left,
    placement,
  }
}

watch(open, async (v) => {
  if (!v) return
  cursor.value = startOfMonth(selected.value ?? today)
  await nextTick()
  measure()
  focusDay(selected.value ?? today)
})

function onScroll() { if (open.value) measure() }
function onResize() { if (open.value) measure() }

onMounted(() => {
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onResize)
  window.addEventListener('pointerdown', onPointer)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('pointerdown', onPointer)
  window.removeEventListener('keydown', onKey)
})

function onPointer(e: PointerEvent) {
  if (!open.value) return
  const t = e.target as Node
  if (triggerEl.value?.contains(t)) return
  if (popupEl.value?.contains(t)) return
  open.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) close()
}
</script>

<template>
  <div class="relative">
    <!-- Hidden input so a parent <form> would still pick up the value. -->
    <input type="hidden" name="wedding_date" :value="modelValue ?? ''">

    <button
      :id="id"
      ref="triggerEl"
      type="button"
      :aria-expanded="open"
      aria-haspopup="dialog"
      class="press flex h-11 w-full items-center justify-between rounded-md border border-(--color-border) bg-white px-3 text-sm text-(--color-foreground) shadow-sm hover:border-(--color-primary)/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring) 3xl:h-12 3xl:text-base 4xl:h-14 4xl:px-4 4xl:text-lg"
      @click="open = !open"
    >
      <span :class="selected ? '' : 'text-(--color-muted-foreground)'">
        {{ triggerLabel }}
      </span>
      <Calendar class="h-4 w-4 shrink-0 text-(--color-muted-foreground)" :stroke-width="1.6" aria-hidden="true" />
    </button>

    <Teleport v-if="mounted" to="body">
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0 scale-[0.98]"
        enter-to-class="opacity-100 scale-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100 scale-100"
        leave-to-class="opacity-0 scale-[0.98]"
      >
        <div
          v-if="open && pos"
          ref="popupEl"
          role="dialog"
          aria-modal="false"
          :aria-label="monthCaption"
          :style="{
            position: 'fixed',
            top: `${pos.top}px`,
            left: `${pos.left}px`,
            transform: pos.placement === 'above' ? 'translateY(-100%)' : undefined,
            zIndex: 50,
          }"
          class="rounded-lg border border-(--color-border) bg-white p-3 shadow-(--shadow-glow)"
          @keydown="onPopupKey"
        >
          <!-- Caption + month nav -->
          <div class="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              :aria-label="t('lead.datePrevMonth')"
              :aria-disabled="!canPrev"
              class="grid h-9 w-9 place-items-center rounded-md text-(--color-primary) transition-colors hover:bg-(--color-accent)/50 aria-disabled:cursor-not-allowed aria-disabled:opacity-30 aria-disabled:hover:bg-transparent"
              @click="prevMonth"
            >
              <ChevronLeft class="h-4 w-4" :stroke-width="2" />
            </button>
            <span class="font-display text-sm capitalize" aria-live="polite">{{ monthCaption }}</span>
            <button
              type="button"
              :aria-label="t('lead.dateNextMonth')"
              :aria-disabled="!canNext"
              class="grid h-9 w-9 place-items-center rounded-md text-(--color-primary) transition-colors hover:bg-(--color-accent)/50 aria-disabled:cursor-not-allowed aria-disabled:opacity-30 aria-disabled:hover:bg-transparent"
              @click="nextMonthFn"
            >
              <ChevronRight class="h-4 w-4" :stroke-width="2" />
            </button>
          </div>

          <!-- Weekday header -->
          <div aria-hidden="true" class="mb-1 grid grid-cols-7 text-center text-[10px] uppercase text-(--color-muted-foreground)">
            <span v-for="(w, i) in weekDayLabels" :key="i" class="py-1">{{ w }}</span>
          </div>

          <!-- Day grid — 36px targets on touch, 32px with a mouse. -->
          <div class="grid grid-cols-7 gap-0.5" @keydown="onGridKey">
            <button
              v-for="d in days"
              :key="d.toISOString()"
              type="button"
              :disabled="isDisabled(d)"
              :tabindex="isSameDay(d, focused) ? 0 : -1"
              :data-focused="isSameDay(d, focused)"
              :aria-label="dayLabel(d)"
              :aria-pressed="!!selected && isSameDay(d, selected)"
              :aria-current="isSameDay(d, today) ? 'date' : undefined"
              :class="[
                'h-9 w-9 rounded-md text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring) pointer-fine:h-8 pointer-fine:w-8 pointer-fine:text-[12px]',
                isSameMonth(d, cursor) ? '' : 'opacity-40',
                isDisabled(d) ? 'cursor-not-allowed opacity-30' : 'hover:bg-(--color-accent)/50',
                selected && isSameDay(d, selected)
                  ? 'bg-(--color-primary) text-(--color-primary-foreground) hover:opacity-90'
                  : isSameDay(d, today)
                    ? 'text-(--color-primary) font-semibold'
                    : 'text-(--color-foreground)',
              ]"
              @click="pickDay(d)"
            >{{ d.getDate() }}</button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
