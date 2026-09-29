<script setup lang="ts">
import { useI18n } from '#imports'
import { motion, useTransform, type MotionValue } from 'motion-v'
import { Check, Download, FileArchive, Play } from '@lucide/vue'
import { useSegment } from '~/composables/useHowScene'
import MarketingPhoto from './Photo.vue'
import PHOTOS from './photo-manifest.json'

/**
 * How it works, scene 3 — the couple's dashboard. The album fills in
 * photo by photo (the first one is the print from scene 2, marked
 * "new"), then the download button is pressed and the ZIP's progress
 * bar runs to a tick.
 */
type PhotoName = keyof typeof PHOTOS

const props = defineProps<{ timeline: MotionValue<number> }>()
const { t } = useI18n()
const seg = useSegment(props.timeline)
const tl = props.timeline

// Guests' shots; the first is the print from scene 2 (its only repeat,
// on purpose). None of them is in the album of StickyHeadline a screen
// above or in the collage right below (GalleryPreview), so no shot shows
// twice on one screen.
const TILES: { photo: PhotoName; position?: string }[] = [
  { photo: 'dance-slow' },
  { photo: 'vintage-camera' },
  { photo: 'first-look' },
  { photo: 'waiter' },
  { photo: 'rings-box' },
  { photo: 'hands-closeup' },
  { photo: 'feet-dancing' },
  { photo: 'jacket' },
  { photo: 'cutting-cake' },
  { photo: 'candles-table' },
  { photo: 'cufflink' },
  { photo: 'bokeh' },
]
const VIDEO_TILE = 6

// Tiles land one after another over the first half of the timeline.
const tiles = TILES.map((tile, i) => {
  const from = i * 0.034
  return {
    ...tile,
    opacity: seg(from, from + 0.12, 0, 1),
    scale: seg(from, from + 0.16, 0.8, 1),
  }
})

const buttonScale = useTransform(tl, [0.56, 0.6, 0.68], [1, 0.95, 1])
const toastOpacity = seg(0.6, 0.72, 0, 1)
const toastY = seg(0.6, 0.76, '40%', '0%')
const fill = seg(0.66, 0.93, 0, 1)
const doneOpacity = seg(0.92, 1, 0, 1)
const doneScale = seg(0.92, 1, 0.4, 1)
</script>

<template>
  <div aria-hidden="true" class="@container absolute inset-0 select-none overflow-hidden bg-[oklch(42%_0.05_60)]">
    <MarketingPhoto
      name="fairy-lights"
      sizes="240px"
      class="absolute left-[-6%] top-[-6%] h-[112%] w-[112%] max-w-none object-cover blur-[5px]"
    />
    <div
      class="absolute inset-0"
      :style="{ background: 'radial-gradient(120% 80% at 50% 40%, oklch(45% 0.06 60 / 0.05) 0%, oklch(26% 0.05 45 / 0.55) 100%)' }"
    />

    <!-- Dashboard window -->
    <div
      class="absolute inset-x-[5%] top-[6.5%] bottom-[6.5%] flex flex-col overflow-hidden rounded-[3.6cqw] bg-[oklch(98.6%_0.01_75)]"
      :style="{ boxShadow: '0 5cqw 9cqw -3cqw oklch(15% 0.04 40 / 0.65), 0 0 0 0.25cqw oklch(100% 0 0 / 0.5)' }"
    >
      <div class="flex h-[6.6cqw] shrink-0 items-center gap-[1cqw] border-b border-(--color-border) px-[3.4cqw]">
        <span class="h-[1.5cqw] w-[1.5cqw] rounded-full bg-[oklch(80%_0.06_30)]" />
        <span class="h-[1.5cqw] w-[1.5cqw] rounded-full bg-[oklch(86%_0.06_80)]" />
        <span class="h-[1.5cqw] w-[1.5cqw] rounded-full bg-[oklch(86%_0.04_140)]" />
        <span class="mx-auto -translate-x-[2.5cqw] rounded-full bg-(--color-muted) px-[3cqw] py-[0.6cqw] text-[1.8cqw] text-(--color-muted-foreground)">memour.uz</span>
      </div>

      <div class="flex items-end justify-between gap-[2cqw] px-[4cqw] pt-[3.2cqw]">
        <div class="min-w-0">
          <p class="truncate text-[1.8cqw] font-medium uppercase tracking-[0.24em] text-(--color-primary)">{{ t('how.scene.couple') }}</p>
          <p class="font-display text-[6.6cqw] font-medium leading-[1.05] text-(--color-foreground)">{{ t('how.scene.album') }}</p>
        </div>
        <p class="shrink-0 pb-[1cqw] text-[2cqw] text-(--color-muted-foreground)">{{ t('how.scene.albumCount') }}</p>
      </div>

      <div class="mt-[2.6cqw] grid grid-cols-4 gap-[1.4cqw] px-[4cqw]">
        <div
          v-for="(tile, i) in tiles"
          :key="tile.photo"
          class="relative aspect-square overflow-hidden rounded-[1.3cqw] bg-[oklch(92.5%_0.02_65)]"
        >
          <motion.div class="absolute inset-0" :style="{ opacity: tile.opacity, scale: tile.scale }">
            <MarketingPhoto
              :name="tile.photo"
              sizes="(min-width: 64rem) 130px, 70px"
              :position="tile.position"
              class="h-full w-full object-cover"
            />
            <span
              v-if="i === 0"
              class="absolute left-[0.8cqw] top-[0.8cqw] rounded-full bg-(--color-primary) px-[1.2cqw] py-[0.3cqw] text-[1.5cqw] font-semibold text-(--color-primary-foreground)"
            >{{ t('how.scene.new') }}</span>
            <span
              v-if="i === VIDEO_TILE"
              class="absolute bottom-[0.8cqw] left-[0.8cqw] flex items-center gap-[0.5cqw] rounded-full bg-black/50 px-[1cqw] py-[0.3cqw] text-[1.4cqw] font-medium text-white"
            >
              <Play class="h-[1.4cqw] w-[1.4cqw] fill-white" :stroke-width="0" />0:12
            </span>
          </motion.div>
        </div>
      </div>

      <div class="relative mt-auto px-[4cqw] pb-[4cqw] pt-[3cqw]">
        <!-- ZIP progress card, rises over the last row once the button is pressed -->
        <motion.div
          class="absolute inset-x-[7cqw] bottom-[14.5cqw] flex items-center gap-[2cqw] rounded-[2.4cqw] bg-white p-[2cqw] shadow-[0_2.4cqw_5cqw_-1.5cqw_oklch(15%_0.04_40/0.45)]"
          :style="{ opacity: toastOpacity, y: toastY }"
        >
          <span class="grid h-[6.4cqw] w-[6.4cqw] shrink-0 place-items-center rounded-[1.4cqw] bg-(--color-accent) text-(--color-primary)">
            <FileArchive class="h-[3.4cqw] w-[3.4cqw]" :stroke-width="1.8" />
          </span>
          <span class="flex min-w-0 flex-1 flex-col gap-[1cqw]">
            <span class="flex items-baseline justify-between gap-[1.4cqw] text-[2cqw] leading-none">
              <span class="truncate font-semibold text-(--color-foreground)">{{ t('how.scene.archiveName') }}</span>
              <span class="shrink-0 text-(--color-muted-foreground)">{{ t('how.scene.archiveSize') }}</span>
            </span>
            <span class="relative h-[1cqw] overflow-hidden rounded-full bg-(--color-muted)">
              <motion.span
                class="absolute inset-0 origin-left rounded-full bg-gradient-to-r from-(--color-primary) to-[oklch(72%_0.09_40)]"
                :style="{ scaleX: fill }"
              />
            </span>
          </span>
          <motion.span
            class="grid h-[4.4cqw] w-[4.4cqw] shrink-0 place-items-center rounded-full bg-emerald-500 text-white"
            :style="{ opacity: doneOpacity, scale: doneScale }"
          >
            <Check class="h-[2.6cqw] w-[2.6cqw]" :stroke-width="3" />
          </motion.span>
        </motion.div>

        <motion.div
          class="relative flex h-[8.4cqw] w-full items-center justify-center gap-[1.4cqw] rounded-full bg-(--color-primary) text-[2.5cqw] font-medium text-(--color-primary-foreground) shadow-[0_1.6cqw_3cqw_-1cqw_oklch(56%_0.09_35/0.55)]"
          :style="{ scale: buttonScale }"
        >
          <Download class="h-[3cqw] w-[3cqw]" :stroke-width="2" />
          {{ t('how.scene.download') }}
        </motion.div>
      </div>
    </div>
  </div>
</template>
