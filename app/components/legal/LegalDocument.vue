<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from '#imports'
import { ChevronDown } from '@lucide/vue'
import type { LegalDocData } from '#shared/legal'

/**
 * A full legal document (privacy policy, terms, public offer) as
 * GET /api/legal/[doc] renders it: header with the dates, a table of
 * contents — a fold-out card on phones and tablets, a sticky column
 * that follows the reading position on desktop — and the text.
 *
 * `html` is built on the server from our own reviewed texts
 * (server/utils/legal-docs.ts escapes everything before adding markup).
 */
const props = defineProps<{ doc: LegalDocData }>()

const { t, locale } = useI18n()
const effective = computed(() => (props.doc.effectiveDate ? formatDate(props.doc.effectiveDate, locale.value) : null))
const version = computed(() => (props.doc.version ? formatDate(props.doc.version, locale.value) : null))

// Phone / tablet: contents fold out under the header.
const tocOpen = ref(false)

// Desktop: highlight the section being read.
const activeId = ref<string | null>(null)
let observer: IntersectionObserver | null = null
onMounted(() => {
  const headings = props.doc.toc
    .map((i) => document.getElementById(i.id))
    .filter((el): el is HTMLElement => !!el)
  if (!headings.length || !('IntersectionObserver' in window)) return
  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (visible[0]) activeId.value = visible[0].target.id
    },
    // "Current" = in the band from just under the sticky header (anchor
    // jumps land at scroll-padding-top, 88 px and up) to 40% down.
    { rootMargin: '-72px 0px -60% 0px' },
  )
  headings.forEach((h) => observer!.observe(h))
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <article class="container-page relative py-16 sm:py-24">
    <div class="mx-auto max-w-6xl lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-14 xl:grid-cols-[17rem_minmax(0,1fr)]">
      <!-- Desktop contents -->
      <nav :aria-label="t('legal.toc')" class="hidden lg:block">
        <div class="sticky top-28 max-h-[calc(100dvh-9rem)] overflow-y-auto pr-2">
          <p class="mb-3 text-[10px] uppercase tracking-[0.3em] text-(--color-muted-foreground)">{{ t('legal.toc') }}</p>
          <ol class="space-y-0.5 border-l border-(--color-border)">
            <li v-for="item in doc.toc" :key="item.id">
              <a
                :href="`#${item.id}`"
                :aria-current="activeId === item.id ? 'location' : undefined"
                :class="[
                  '-ml-px block border-l-2 py-1.5 pl-3 text-[13px] leading-snug transition-colors duration-200',
                  activeId === item.id
                    ? 'border-(--color-primary) text-(--color-foreground)'
                    : 'border-transparent text-(--color-muted-foreground) hover:text-(--color-foreground)',
                ]"
              >{{ item.text }}</a>
            </li>
          </ol>
        </div>
      </nav>

      <div class="min-w-0 max-w-3xl">
        <header>
          <p class="mb-2 text-xs uppercase tracking-[0.3em] text-(--color-muted-foreground)">Memour</p>
          <h1 class="heading-display-md italic text-balance text-(--color-foreground)">{{ doc.title }}</h1>
          <p v-if="doc.subtitle" class="mt-3 text-base text-(--color-muted-foreground)">{{ doc.subtitle }}</p>
          <p v-if="effective || version" class="mt-4 text-xs text-(--color-muted-foreground)">
            <span v-if="effective">{{ t('legal.effective', { date: effective }) }}</span>
            <span v-if="effective && version" aria-hidden="true"> · </span>
            <span v-if="version">{{ t('legal.version', { date: version }) }}</span>
          </p>
          <p
            v-if="doc.mode === 'preview'"
            role="note"
            class="mt-5 rounded-(--radius-md) border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >{{ t('legal.preview') }}</p>
        </header>

        <!-- Phone / tablet contents -->
        <nav :aria-label="t('legal.toc')" class="mt-8 lg:hidden">
          <div class="rounded-(--radius-lg) border border-(--color-border) bg-white/70 backdrop-blur">
            <button
              type="button"
              class="flex min-h-12 w-full touch-manipulation items-center justify-between gap-3 px-5 text-left text-sm font-medium"
              :aria-expanded="tocOpen"
              aria-controls="legal-toc-list"
              @click="tocOpen = !tocOpen"
            >
              {{ t('legal.toc') }}
              <ChevronDown
                class="h-4 w-4 shrink-0 text-(--color-muted-foreground) transition-transform duration-(--spring-snappy) ease-(--ease-spring)"
                :class="tocOpen ? 'rotate-180' : ''"
              />
            </button>
            <Transition
              enter-active-class="transition-[opacity,transform] duration-(--spring-default) ease-(--ease-spring)"
              enter-from-class="opacity-0 -translate-y-1"
              leave-active-class="transition-opacity duration-150"
              leave-to-class="opacity-0"
            >
              <ol v-show="tocOpen" id="legal-toc-list" class="border-t border-(--color-border) px-2 py-2">
                <li v-for="item in doc.toc" :key="item.id">
                  <a
                    :href="`#${item.id}`"
                    class="flex min-h-11 items-center rounded-md px-3 text-sm leading-snug text-(--color-muted-foreground) hover:bg-(--color-muted) hover:text-(--color-foreground)"
                    @click="tocOpen = false"
                  >{{ item.text }}</a>
                </li>
              </ol>
            </Transition>
          </div>
        </nav>

        <!-- eslint-disable-next-line vue/no-v-html -- server-rendered from our own escaped texts -->
        <div class="legal-body mt-10" v-html="doc.html" />
      </div>
    </div>
  </article>
</template>

<style scoped>
@reference "~/assets/css/main.css";

.legal-body {
  @apply text-[15px] leading-relaxed text-(--color-muted-foreground);
  overflow-wrap: anywhere;
}
.legal-body :deep(h2) { @apply mt-14 mb-4 font-display text-[1.75rem] leading-tight italic text-(--color-foreground) sm:text-3xl; text-wrap: balance; }
.legal-body :deep(h2:first-child) { @apply mt-0; }
.legal-body :deep(h3) { @apply mt-9 mb-3 text-base font-semibold text-(--color-foreground); }
.legal-body :deep(h4) { @apply mt-7 mb-2 text-sm font-semibold text-(--color-foreground); }
.legal-body :deep(p) { @apply mb-4; }
.legal-body :deep(ul) { @apply mb-4 ml-5 list-disc space-y-1.5; }
.legal-body :deep(ol) { @apply mb-4 ml-5 list-decimal space-y-1.5; }
.legal-body :deep(li.nested) { @apply ml-5; }
.legal-body :deep(li)::marker { color: oklch(56% 0.09 35 / 0.6); }
.legal-body :deep(strong) { @apply font-semibold text-(--color-foreground); }
.legal-body :deep(a) { @apply text-(--color-primary) underline decoration-(--color-primary)/40 underline-offset-2 hover:decoration-(--color-primary); }
.legal-body :deep(blockquote) { @apply my-6 rounded-r-(--radius-md) border-l-2 border-(--color-primary)/40 bg-white/60 px-4 py-3 text-sm; }
.legal-body :deep(blockquote p:last-child) { @apply mb-0; }
.legal-body :deep(hr) { @apply my-12 border-(--color-border); }
.legal-body :deep(mark) { @apply rounded bg-amber-100 px-0.5 text-amber-900; }
/* Tables: from tablet up a real table that scrolls inside its own box
 * if it must (the page never does); on phones every row becomes a card
 * of "column: value" lines. */
.legal-body :deep(.legal-table) { @apply my-6 overflow-x-auto rounded-(--radius-md) border border-(--color-border) bg-white/60; }
.legal-body :deep(table) { @apply w-full min-w-[34rem] border-collapse text-left text-[13px] leading-snug; overflow-wrap: normal; }
.legal-body :deep(th) { @apply border-b border-(--color-border) px-3 py-2 align-top font-semibold text-(--color-foreground); }
.legal-body :deep(td) { @apply border-b border-(--color-border)/70 px-3 py-2 align-top; }
.legal-body :deep(tr:last-child td) { @apply border-b-0; }
@media (max-width: 639px) {
  .legal-body :deep(.legal-table) { @apply overflow-visible border-0 bg-transparent; }
  .legal-body :deep(table) { @apply min-w-0 text-sm; overflow-wrap: anywhere; }
  .legal-body :deep(thead) { @apply sr-only; }
  .legal-body :deep(table), .legal-body :deep(tbody), .legal-body :deep(tr), .legal-body :deep(td) { display: block; }
  .legal-body :deep(tr) { @apply mb-3 rounded-(--radius-md) border border-(--color-border) bg-white/60 px-4 py-2; }
  .legal-body :deep(td) { @apply border-0 px-0 py-1.5; }
  .legal-body :deep(td[data-label]:not([data-label=""]))::before {
    content: attr(data-label);
    @apply mb-0.5 block text-[11px] font-semibold uppercase tracking-wider text-(--color-foreground)/70;
  }
}
</style>
