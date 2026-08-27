<script setup lang="ts">
import { motion } from 'motion-v'
import { computed } from 'vue'
import { useI18n, useLocalePath } from '#imports'

/**
 * Custom error page — branded fallback for 404 / 500 / etc.
 *
 * The layout is a "missing polaroid": a small empty-frame Polaroid
 * card centered above the giant 404 number, tying the error to the
 * wedding-photo theme ("kadr yo'qoldi" — a frame got lost). Subtle
 * floating sparkles drift around the polaroid for a tactile feel.
 */
const props = defineProps<{
  error: { statusCode: number, message?: string, statusMessage?: string }
}>()

const { t } = useI18n()
const localePath = useLocalePath()

const code = computed(() => props.error?.statusCode ?? 500)
const isNotFound = computed(() => code.value === 404)
</script>

<template>
  <div class="relative min-h-screen overflow-hidden">
    <MarketingGlobalBackground />

    <main class="container-page relative grid min-h-screen place-items-center py-16">
      <div class="mx-auto max-w-xl text-center">
        <!-- Floating ornament: empty polaroid sits in normal flow so
             its real height (card + caption) drives layout. Sparkles
             absolutely positioned around it, including outside bounds
             via negative offsets — the parent has `inline-block` so
             its width matches the polaroid, giving a clean center. -->
        <div class="relative mx-auto mb-8 inline-block">
          <!-- Sparkles drifting around the polaroid -->
          <motion.div
            v-for="(sp, i) in 6"
            :key="`sp-${i}`"
            aria-hidden="true"
            :initial="{ opacity: 0, scale: 0.4 }"
            :animate="{ opacity: [0, 1, 0], scale: [0.4, 1.1, 0.4] }"
            :transition="{
              duration: 3.2,
              repeat: Infinity,
              delay: i * 0.45,
              ease: 'easeInOut',
            }"
            class="pointer-events-none absolute z-10"
            :style="{
              top: ['-8%', '4%', '85%', '95%', '38%', '60%'][i],
              left: ['-12%', '92%', '-14%', '88%', '-22%', '108%'][i],
            }"
          >
            <svg viewBox="0 0 20 20" style="width: 14px; height: 14px;">
              <path
                d="M10 0 L11.5 8.5 L20 10 L11.5 11.5 L10 20 L8.5 11.5 L0 10 L8.5 8.5 Z"
                fill="oklch(78% 0.1 70)"
              />
            </svg>
          </motion.div>

          <!-- Polaroid card with empty photo frame. Inline styles
               throughout because Tailwind v4's @source scanning may
               skip error.vue (it's outside the page graph), so any
               utility classes risk getting purged. -->
          <motion.div
            :initial="{ opacity: 0, y: 20, rotate: -8, scale: 0.92 }"
            :animate="{ opacity: 1, y: 0, rotate: -4, scale: 1 }"
            :transition="{ duration: 1, ease: [0.16, 1, 0.3, 1] }"
          >
            <div
              style="
                display: grid;
                grid-template-rows: 1fr auto;
                width: 9.5rem;
                height: 12rem;
                padding: 0.5rem;
                border-radius: 0.375rem;
                background: white;
                border: 1px solid rgba(255,255,255,0.8);
                box-shadow: 0 24px 60px -20px rgb(160 110 90 / 0.55), 0 2px 6px -1px rgb(160 110 90 / 0.15);
              "
            >
              <div
                style="
                  overflow: hidden;
                  border-radius: 0.125rem;
                  border: 1px dashed var(--color-border);
                  background: linear-gradient(135deg, oklch(95% 0.04 60), oklch(92% 0.05 30 / 0.6));
                "
              >
                <svg viewBox="0 0 100 100" style="width:100%; height:100%; opacity:0.25;">
                  <line x1="20" y1="20" x2="80" y2="80" stroke="oklch(60% 0.06 40)" stroke-width="1.2" />
                  <line x1="80" y1="20" x2="20" y2="80" stroke="oklch(60% 0.06 40)" stroke-width="1.2" />
                </svg>
              </div>
              <p
                style="
                  margin-top: 0.5rem;
                  text-align: center;
                  font-family: var(--font-display);
                  font-style: italic;
                  font-size: 12px;
                  color: var(--color-muted-foreground);
                "
              >
                {{ isNotFound ? t('error.polaroidCaptionNotFound') : t('error.polaroidCaptionGeneric') }}
              </p>
            </div>
          </motion.div>
        </div>

        <!-- Eyebrow with ⋄ separators -->
        <motion.div
          :initial="{ opacity: 0 }"
          :animate="{ opacity: 1 }"
          :transition="{ duration: 0.6, delay: 0.5 }"
          class="mx-auto flex items-center justify-center gap-3 text-xs uppercase tracking-[0.3em] text-(--color-muted-foreground)"
        >
          <span aria-hidden="true">⋄</span>
          <span>{{ isNotFound ? t('error.notFoundEyebrow') : t('error.genericEyebrow') }}</span>
          <span aria-hidden="true">⋄</span>
        </motion.div>

        <!-- Big 404 with gradient gold. The motion wrapper is a div
             so the h1 stays semantic; motion-v reliably handles
             motion.div across all targets while custom tags like
             motion.h1 can fall through on some setups. -->
        <motion.div
          :initial="{ opacity: 0, y: 16 }"
          :animate="{ opacity: 1, y: 0 }"
          :transition="{ duration: 0.8, delay: 0.65 }"
        >
          <h1
            class="mt-4 font-display italic tracking-tight"
            style="font-size: clamp(4.5rem, 12vw, 9rem); line-height: 0.95;"
          >
            <span
              style="
                background: linear-gradient(120deg, oklch(50% 0.1 35), oklch(70% 0.08 50), oklch(55% 0.09 30));
                -webkit-background-clip: text;
                background-clip: text;
                color: transparent;
                -webkit-text-fill-color: transparent;
              "
            >{{ code }}</span>
          </h1>
        </motion.div>

        <motion.div
          :initial="{ opacity: 0, y: 12 }"
          :animate="{ opacity: 1, y: 0 }"
          :transition="{ duration: 0.7, delay: 0.85 }"
        >
          <p class="mx-auto mt-4 max-w-md text-pretty text-base leading-relaxed text-(--color-muted-foreground) md:text-lg">
            {{ isNotFound ? t('error.notFoundDesc') : t('error.genericDesc') }}
          </p>
        </motion.div>

        <motion.div
          :initial="{ opacity: 0, y: 12 }"
          :animate="{ opacity: 1, y: 0 }"
          :transition="{ duration: 0.7, delay: 1.05 }"
          class="mt-9 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center"
        >
          <NuxtLink
            :to="localePath('/')"
            class="group relative inline-flex h-12 items-center justify-center overflow-hidden rounded-md bg-(--color-primary) px-7 text-base font-medium text-(--color-primary-foreground) shadow-(--shadow-soft) hover:opacity-90"
          >
            <span class="relative z-10">{{ t('error.backHome') }}</span>
            <span class="absolute inset-0 -z-0 bg-gradient-to-r from-(--color-primary) via-(--color-rose) to-(--color-primary) bg-[length:200%_100%] opacity-0 transition-opacity duration-500 group-hover:opacity-100 group-hover:[animation:shimmer_2.4s_linear_infinite]" />
          </NuxtLink>
          <NuxtLink
            :to="`${localePath('/')}#lead`"
            class="inline-flex h-12 items-center justify-center rounded-md border border-(--color-border) bg-white/70 px-7 text-base font-medium backdrop-blur transition-colors hover:bg-(--color-muted)"
          >
            {{ t('error.contactUs') }}
          </NuxtLink>
        </motion.div>
      </div>
    </main>
  </div>
</template>
