<script setup lang="ts">
import { useI18n } from '#imports'
import { motion, motionValue, animate, useTransform, useMotionValueEvent, type MotionValue } from 'motion-v'
import { Camera, Check, Mic, Video } from '@lucide/vue'
import { useSegment } from '~/composables/useHowScene'
import MarketingPhoto from './Photo.vue'

/**
 * How it works, scene 2 — the guest page on a phone: the couple's
 * cover photo, their names in the display face, the table, the big
 * "take a photo" button and the photo / video / voice dock, as the
 * real guest page lays them out.
 * Timeline: a beat to take the screen in, a tap on the button (press +
 * ripple), the shutter flash, then the photo just taken rises out of
 * the button as a print and settles beside the phone with a "sent"
 * tick, and the dock's photo counter rolls on by one.
 */
const props = defineProps<{ timeline: MotionValue<number> }>()
const { t } = useI18n()
const seg = useSegment(props.timeline)
const tl = props.timeline

// The tap waits for the scene to have faded in (the stage hands over
// on a ~0.35 s spring and paces the timeline, see How.vue).
const buttonScale = useTransform(tl, [0.22, 0.3, 0.42], [1, 0.95, 1])
const rippleScale = seg(0.22, 0.52, 0.4, 1.9)
const rippleOpacity = useTransform(tl, [0.22, 0.28, 0.52], [0, 0.75, 0])

// The shutter flash is an event, not a pose: it fires once, on the
// clock, when the timeline passes the shot going forwards — a scroll
// that stops mid-way never freezes the screen white, scrubbing back
// doesn't flash, and the static frame (timeline pinned at 1) never does.
// It goes off as the button comes back up.
const SHOT = 0.4
const flash = motionValue(0)
let last = tl.get()
useMotionValueEvent(tl, 'change', (v) => {
  if (last < SHOT && v >= SHOT) {
    animate(flash, [0, 0.85, 0], { duration: 0.38, times: [0, 0.14, 1], ease: ['easeOut', 'easeOut'] })
  }
  last = v
})

// Right after the flash, the print starts at the button (small) and
// lands top right; x settles a little sooner than y, so it travels on a
// slight arc.
const printOpacity = useTransform(tl, [0.44, 0.51], [0, 1])
const printX = seg(0.44, 0.86, '-105%', '0%')
const printY = seg(0.44, 0.93, '170%', '0%')
const printScale = seg(0.44, 0.89, 0.28, 1)
const printRotate = seg(0.44, 0.93, -8, 7)
const sentOpacity = seg(0.85, 0.96, 0, 1)
const sentY = seg(0.85, 0.99, '70%', '0%')
// The photo tab's counter rolls from 2 to 3 as the print is sent.
const countOld = seg(0.87, 0.99, 1, 0)
const countOldY = seg(0.87, 0.99, '0%', '-110%')
const countNew = seg(0.87, 0.99, 0, 1)
const countNewY = seg(0.87, 0.99, '110%', '0%')

// Premium limits (server/utils/guest-quota.ts).
const DOCK = [
  { icon: Video, count: '1/15' },
  { icon: Mic, count: '0/3' },
] as const
</script>

<template>
  <div aria-hidden="true" class="@container absolute inset-0 select-none overflow-hidden bg-[oklch(40%_0.05_55)]">
    <MarketingPhoto
      name="bokeh"
      sizes="240px"
      class="absolute left-[-6%] top-[-6%] h-[112%] w-[112%] max-w-none object-cover blur-[5px]"
    />
    <div
      class="absolute inset-0"
      :style="{ background: 'radial-gradient(110% 75% at 50% 45%, oklch(45% 0.06 60 / 0) 0%, oklch(26% 0.05 45 / 0.55) 100%)' }"
    />

    <!-- Phone -->
    <div
      class="absolute inset-x-0 top-[6%] mx-auto aspect-[9/19] w-[47%] rounded-[7.4cqw] p-[1.3cqw]"
      :style="{
        background: 'linear-gradient(150deg, oklch(34% 0.012 50), oklch(15% 0.01 50) 60%, oklch(24% 0.012 50))',
        boxShadow: '0 5cqw 9cqw -3cqw oklch(15% 0.04 40 / 0.7), 0 0 0 0.25cqw oklch(55% 0.02 60 / 0.5)',
      }"
    >
      <div class="relative flex h-full flex-col overflow-hidden rounded-[6.2cqw] bg-(--color-background)">
        <!-- Cover (a wide shot cropped to the couple: sized for the crop) -->
        <div class="relative h-[40%] shrink-0">
          <MarketingPhoto
            name="slideshow-hero-wide"
            sizes="(min-width: 64rem) 440px, 220px"
            position="78% center"
            class="absolute inset-0 h-full w-full object-cover"
          />
          <div class="absolute inset-x-0 -bottom-px h-[56%] bg-gradient-to-t from-(--color-background) via-(--color-background)/70 to-transparent" />
          <div class="absolute inset-x-0 top-0 flex items-center justify-between px-[4cqw] pt-[1.8cqw] text-[1.9cqw] font-semibold text-white [text-shadow:0_0_0.8cqw_oklch(20%_0.03_40/0.55)]">
            <span>21:34</span>
            <span class="flex items-center gap-[0.6cqw]">
              <span class="h-[1.1cqw] w-[2.4cqw] rounded-[0.3cqw] border border-white/90" />
            </span>
          </div>
          <span class="absolute left-1/2 top-[1.4cqw] h-[3cqw] w-[12cqw] -translate-x-1/2 rounded-full bg-black" />
        </div>

        <div class="relative -mt-[3cqw] flex flex-1 flex-col items-center px-[3.4cqw] pb-[2.6cqw] text-center">
          <p class="text-[1.6cqw] font-medium uppercase tracking-[0.3em] text-(--color-primary)">{{ t('guest.welcome.eyebrow') }}</p>
          <p class="mt-[1cqw] font-display text-[5.4cqw] font-medium italic leading-[1.02] text-balance">
            <span class="text-gradient-gold">{{ t('how.scene.couple') }}</span>
          </p>
          <p class="mt-[0.8cqw] text-[1.6cqw] tracking-[0.22em] text-(--color-muted-foreground)">{{ t('how.scene.date') }}</p>
          <span class="mt-[1.6cqw] flex items-center gap-[1cqw] text-[1.4cqw] text-[oklch(55%_0.1_70)]">
            <span class="h-px w-[5cqw] bg-gradient-to-r from-transparent to-(--color-border)" />✦<span class="h-px w-[5cqw] bg-gradient-to-l from-transparent to-(--color-border)" />
          </span>
          <!-- The gold table badge of the real guest page -->
          <span class="mt-[1.8cqw] flex flex-col items-center rounded-full border border-[oklch(88%_0.05_85/0.7)] bg-gradient-to-br from-[oklch(98%_0.02_90)] via-[oklch(97%_0.03_85)] to-[oklch(93%_0.05_85)] px-[4.4cqw] py-[1cqw] shadow-[0_1.2cqw_3cqw_-1cqw_oklch(60%_0.08_70/0.4)]">
            <span class="text-[1.2cqw] uppercase leading-tight tracking-[0.34em] text-[oklch(50%_0.1_65/0.85)]">{{ t('guest.welcome.tableEyebrow') }}</span>
            <span class="font-display text-[4.2cqw] italic leading-none text-[oklch(38%_0.07_60)]">{{ t('how.scene.tableNo') }}</span>
          </span>
          <p class="mt-[2cqw] line-clamp-4 text-[1.55cqw] italic leading-snug text-(--color-muted-foreground)">{{ t('guest.welcome.greetingDefault') }}</p>

          <div class="relative mt-auto w-full">
            <motion.div
              class="relative z-10 flex h-[8cqw] w-full items-center justify-center gap-[1.4cqw] rounded-full bg-(--color-primary) text-[2.3cqw] font-medium text-(--color-primary-foreground) shadow-[0_1.6cqw_3cqw_-1cqw_oklch(56%_0.09_35/0.6)]"
              :style="{ scale: buttonScale }"
            >
              <Camera class="h-[3cqw] w-[3cqw]" :stroke-width="2" />
              {{ t('how.scene.takePhoto') }}
            </motion.div>
            <motion.span
              class="absolute left-1/2 top-1/2 -ml-[7cqw] -mt-[7cqw] h-[14cqw] w-[14cqw] rounded-full border-[0.5cqw] border-(--color-primary)"
              :style="{ scale: rippleScale, opacity: rippleOpacity }"
            />
          </div>

          <!-- Dock: photo / video / voice, each with its own count -->
          <div class="mt-[2.2cqw] flex w-full items-center gap-[0.6cqw] rounded-full border border-(--color-border) bg-white p-[0.6cqw] shadow-[0_0.4cqw_1.4cqw_oklch(40%_0.04_50/0.08)]">
            <span class="flex flex-1 items-center justify-center gap-[0.8cqw] rounded-full bg-(--color-accent) py-[1.1cqw] text-(--color-primary)">
              <Camera class="h-[2.2cqw] w-[2.2cqw]" :stroke-width="2" />
              <span class="grid overflow-hidden text-[1.5cqw] font-semibold leading-none tabular-nums">
                <motion.span class="col-start-1 row-start-1" :style="{ opacity: countOld, y: countOldY }">2/50</motion.span>
                <motion.span class="col-start-1 row-start-1" :style="{ opacity: countNew, y: countNewY }">3/50</motion.span>
              </span>
            </span>
            <span
              v-for="(tab, i) in DOCK"
              :key="i"
              class="flex flex-1 items-center justify-center gap-[0.8cqw] py-[1.1cqw] text-(--color-muted-foreground)"
            >
              <component :is="tab.icon" class="h-[2.2cqw] w-[2.2cqw]" :stroke-width="2" />
              <span class="text-[1.5cqw] font-medium leading-none tabular-nums">{{ tab.count }}</span>
            </span>
          </div>
        </div>

        <!-- Shutter flash: over the whole screen, button included -->
        <motion.div class="absolute inset-0 z-20 bg-white" :style="{ opacity: flash }" />
      </div>
    </div>

    <!-- The photo just taken -->
    <motion.div
      class="absolute right-[4%] top-[9%] w-[28%] @md:w-[31%]"
      :style="{ x: printX, y: printY, scale: printScale, rotate: printRotate, opacity: printOpacity }"
    >
      <div class="rounded-[1cqw] bg-white p-[1.4cqw] pb-[5.4cqw] shadow-[0_3cqw_6cqw_-2cqw_oklch(15%_0.04_40/0.65)]">
        <div class="aspect-square overflow-hidden rounded-[0.5cqw] bg-(--color-accent)">
          <MarketingPhoto name="dance-slow" sizes="(min-width: 64rem) 300px, 160px" class="h-full w-full object-cover" />
        </div>
      </div>
      <motion.div
        class="absolute left-1/2 top-[calc(100%-2.6cqw)] flex -translate-x-1/2 items-center gap-[1cqw] whitespace-nowrap rounded-full bg-white py-[0.8cqw] pl-[0.8cqw] pr-[2.2cqw] shadow-[0_1.6cqw_3.4cqw_-1cqw_oklch(15%_0.04_40/0.5)]"
        :style="{ opacity: sentOpacity, y: sentY }"
      >
        <span class="grid h-[3.6cqw] w-[3.6cqw] place-items-center rounded-full bg-emerald-500 text-white">
          <Check class="h-[2.2cqw] w-[2.2cqw]" :stroke-width="3" />
        </span>
        <span class="text-[2.2cqw] font-medium text-(--color-foreground)">{{ t('how.scene.sent') }}</span>
      </motion.div>
    </motion.div>
  </div>
</template>
