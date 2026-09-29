<script setup lang="ts">
import { useI18n } from '#imports'
import { motion, type MotionValue } from 'motion-v'
import { HOW_QR, useSegment } from '~/composables/useHowScene'
import MarketingPhoto from './Photo.vue'

/**
 * How it works, scene 1 — the table card. A printed tent card with the
 * couple's names, "Table 7" and a real QR stands on a softly blurred
 * banquet table; the PDF it came from floats in the corner.
 * Timeline: the card settles onto the table, the QR prints top to
 * bottom under a gold print line, the PDF chip slides in.
 * Everything is sized in cqw of the scene, so it is the same picture
 * in a 300 px phone card and in the 680 px desktop stage.
 */
const props = defineProps<{ timeline: MotionValue<number> }>()
const { t } = useI18n()
const seg = useSegment(props.timeline)

const cardY = seg(0, 0.5, '12%', '0%')
const cardRotate = seg(0, 0.55, -8, -2.5)
// A paper-white cover slides off the code downwards — the print head.
const printY = seg(0.2, 0.75, '0%', '101%')
const pdfOpacity = seg(0.62, 0.8, 0, 1)
const pdfX = seg(0.62, 0.95, '-14%', '0%')

const INK = 'oklch(26% 0.03 45)'
const GOLD = 'oklch(74% 0.08 72)'
</script>

<template>
  <div aria-hidden="true" class="@container absolute inset-0 select-none overflow-hidden bg-[oklch(42%_0.05_50)]">
    <MarketingPhoto
      name="candles-table"
      sizes="240px"
      class="absolute left-[-6%] top-[-6%] h-[112%] w-[112%] max-w-none object-cover blur-[5px]"
    />
    <div
      class="absolute inset-0"
      :style="{ background: 'radial-gradient(120% 80% at 50% 38%, oklch(40% 0.06 60 / 0) 0%, oklch(28% 0.05 45 / 0.5) 100%)' }"
    />
    <!-- Contact shadow the card stands in. -->
    <div class="absolute left-1/2 top-[68.5%] h-[9%] w-[62%] -translate-x-1/2 rounded-[50%] bg-[oklch(18%_0.03_40/0.55)] blur-[3cqw]" />

    <motion.div
      class="absolute inset-x-0 top-[8%] mx-auto w-[54%]"
      :style="{ y: cardY, rotate: cardRotate }"
    >
      <div
        class="relative flex aspect-[5/6.8] flex-col items-center rounded-[1.8cqw] px-[4cqw] pb-[3cqw] pt-[5cqw] text-center"
        :style="{
          background: 'linear-gradient(165deg, oklch(99.3% 0.006 85), oklch(96.2% 0.02 75))',
          boxShadow: '0 0.2cqw 0 oklch(100% 0 0 / 0.9) inset, 0 4cqw 7cqw -2.5cqw oklch(18% 0.04 40 / 0.6), 0 0.6cqw 1.4cqw oklch(18% 0.04 40 / 0.3)',
        }"
      >
        <span class="pointer-events-none absolute inset-[2cqw] rounded-[1cqw] border" :style="{ borderColor: GOLD, opacity: 0.7 }" />
        <span class="pointer-events-none absolute inset-[2.8cqw] rounded-[0.6cqw] border" :style="{ borderColor: GOLD, opacity: 0.35 }" />

        <p class="text-[2cqw] font-medium uppercase tracking-[0.26em] text-[oklch(50%_0.06_50)]">{{ t('how.scene.couple') }}</p>
        <p class="mt-[1.4cqw] font-display text-[8.6cqw] font-medium italic leading-none text-(--color-foreground)">{{ t('how.scene.table') }}</p>

        <div class="relative mt-[3cqw] aspect-square w-[72%] overflow-hidden rounded-[1.4cqw] bg-white p-[2.6cqw] shadow-[0_0_0_0.25cqw_oklch(92%_0.02_70)]">
          <svg :viewBox="`0 0 ${HOW_QR.size} ${HOW_QR.size}`" class="block h-full w-full" fill="none" :stroke="INK">
            <path :d="HOW_QR.path" stroke-width="0.84" stroke-linecap="round" />
            <g v-for="([x, y], i) in HOW_QR.finders" :key="i">
              <rect :x="x + 0.5" :y="y + 0.5" width="6" height="6" rx="1.9" stroke-width="1" />
              <rect :x="x + 2" :y="y + 2" width="3" height="3" rx="0.9" :fill="INK" stroke="none" />
            </g>
          </svg>
          <motion.div class="absolute inset-0 bg-white" :style="{ y: printY }">
            <span
              class="absolute inset-x-0 top-0 h-[0.45cqw]"
              :style="{ background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`, boxShadow: `0 0 2cqw 0.4cqw ${GOLD}` }"
            />
          </motion.div>
        </div>

        <p class="mt-[2.8cqw] text-[2cqw] leading-snug text-(--color-muted-foreground)">{{ t('how.scene.scanHint') }}</p>
        <span class="mt-auto flex items-center gap-[1cqw] text-[1.5cqw] leading-none" :style="{ color: GOLD }">
          <span class="h-px w-[6cqw]" :style="{ background: `linear-gradient(90deg, transparent, ${GOLD})` }" />✦<span class="h-px w-[6cqw]" :style="{ background: `linear-gradient(270deg, transparent, ${GOLD})` }" />
        </span>
        <p class="mt-[1.4cqw] font-display text-[3cqw] italic leading-none text-(--color-primary)">memour</p>
      </div>
    </motion.div>

    <motion.div
      class="absolute bottom-[6.5%] left-[6%] flex items-center gap-[2cqw] rounded-[2.4cqw] bg-white/95 py-[1.8cqw] pl-[1.8cqw] pr-[3.4cqw] shadow-[0_2cqw_5cqw_-1.5cqw_oklch(18%_0.04_40/0.55)]"
      :style="{ opacity: pdfOpacity, x: pdfX }"
    >
      <span class="grid h-[7.4cqw] w-[6.2cqw] place-items-center rounded-[1cqw] bg-(--color-primary) text-[1.9cqw] font-bold tracking-wide text-(--color-primary-foreground)">PDF</span>
      <span class="flex flex-col text-left">
        <span class="text-[2.6cqw] font-semibold leading-tight text-(--color-foreground)">{{ t('how.scene.pdfTitle') }}</span>
        <span class="text-[2.2cqw] leading-tight text-(--color-muted-foreground)">{{ t('how.scene.pdfMeta') }}</span>
      </span>
    </motion.div>
  </div>
</template>
