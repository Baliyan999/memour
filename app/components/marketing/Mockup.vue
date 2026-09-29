<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '#imports'
import { Battery, Heart, MapPin, Play, Send, Signal, Wifi, X } from '@lucide/vue'

/**
 * Mockup — small UI mock specific to each feature. CSS/SVG UI over a
 * few small photos, no scroll/state subscriptions. Each variant is a
 * stylised reproduction of the real product UI for that feature
 * (projector slideshow, phone recording, voice bubble, swipe deck,
 * geofence map) — and a preview of the Telegram bot still to come.
 */
const props = defineProps<{
  cardKey: 'slideshow' | 'video' | 'voice' | 'swipe' | 'geofence' | 'telegram'
  hue: number
  isHero: boolean
}>()

const { t } = useI18n()

// Voice bubble pre-renders a deterministic waveform — rounded ints so
// SSR and client agree.
const voiceBars = computed(() =>
  Array.from({ length: 26 }, (_, i) => {
    const amp = Math.abs(Math.sin(i * 0.45) * 0.6 + Math.sin(i * 1.1) * 0.4)
    return { h: Math.round(4 + amp * 18), played: i < 10 }
  }),
)

const senderInitial = computed(() => t('features.mockup.voiceSender').slice(0, 1))

// Photo slots — crops and sizes in scripts/optimize-images.mjs (MOCK).
// The first projector thumbnail is the photo on screen.
const STRIP = ['mock-strip-slideshow', 'mock-strip-dance', 'mock-strip-bouquet', 'mock-strip-sparklers', 'mock-strip-candles'] as const
const ALBUM = ['mock-album-couple', 'mock-album-table', 'mock-album-first-look', 'mock-album-champagne'] as const
</script>

<template>
  <!-- ───────────── Slideshow (Hero) ───────────── -->
  <!-- The projector frame is 16:9 and the photo fills it, with the
       live bar and thumbnail strip floating over it — so the photo is
       never squeezed into a letterbox strip on narrow cards. It grows
       with the bento card (whose stage is at least that big from xl
       on, see Features), and its bar, caption and strip grow with it. -->
  <div v-if="cardKey === 'slideshow'" class="absolute inset-0 grid place-items-center p-5 sm:p-8">
    <div
      class="relative aspect-[16/9] w-full max-w-[480px] overflow-hidden rounded-xl border border-(--color-border)/70 xl:max-w-[600px] 2xl:max-w-[700px] 3xl:max-w-[860px] 4xl:max-w-[1000px]"
      :style="{
        background: 'oklch(18% 0.02 280)',
        boxShadow: `0 40px 70px -30px oklch(50% 0.1 ${hue} / 0.5), 0 0 0 6px oklch(15% 0.015 280), 0 0 0 7px oklch(40% 0.04 280)`,
      }"
    >
      <MarketingPhoto
        name="slideshow-hero-wide"
        sizes="(min-width: 2560px) 1000px, (min-width: 1920px) 860px, (min-width: 1536px) 700px, (min-width: 1280px) 600px, (min-width: 640px) 480px, 80vw"
        class="absolute inset-0 h-full w-full object-cover"
      />
      <div
        aria-hidden="true"
        class="absolute inset-0"
        :style="{ background: 'linear-gradient(to bottom, rgb(0 0 0 / 0.45), transparent 30%, transparent 58%, rgb(0 0 0 / 0.6))' }"
      />

      <!-- Top bar -->
      <div class="absolute inset-x-0 top-0 z-10 flex items-center gap-2 px-3 py-2 xl:px-4 xl:py-3 3xl:gap-3 3xl:px-5 3xl:py-4 4xl:px-6">
        <div class="flex items-center gap-1.5 rounded-full bg-red-500/20 px-2 py-0.5 ring-1 ring-red-400/50 3xl:gap-2 3xl:px-3 3xl:py-1">
          <span class="relative flex h-1.5 w-1.5 3xl:h-2 3xl:w-2">
            <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span class="relative inline-flex h-full w-full rounded-full bg-red-500" />
          </span>
          <span class="text-[9px] font-semibold uppercase tracking-wider text-red-200 xl:text-[11px] 3xl:text-sm 4xl:text-base">Live</span>
        </div>
        <span class="truncate text-[10px] text-white/70 xl:text-xs 3xl:text-sm 4xl:text-base">{{ t('features.mockup.slideshowVenue') }}</span>
        <span class="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-sm xl:text-xs 3xl:px-3 3xl:py-1 3xl:text-sm 4xl:text-base">247</span>
      </div>

      <!-- Caption of the photo on screen. The phone frame is too narrow
           for one line to clear the couple, so there it stacks into two
           short lines tucked into the bottom-left corner. -->
      <div class="absolute bottom-8 left-2 z-10 flex flex-col rounded-md bg-black/45 px-1.5 py-0.5 text-[8px] leading-tight text-white/90 backdrop-blur-sm sm:bottom-11 sm:left-3 sm:flex-row sm:gap-1 sm:rounded-full sm:px-2 sm:text-[9px] sm:leading-normal xl:bottom-14 xl:left-4 xl:text-[11px] 2xl:bottom-16 3xl:bottom-[4.75rem] 3xl:left-5 3xl:px-3 3xl:py-1 3xl:text-sm 4xl:bottom-[5.5rem] 4xl:left-6 4xl:text-base">
        <span>{{ t('features.mockup.slideshowCaptionFrom') }}</span>
        <span aria-hidden="true" class="hidden sm:inline">·</span>
        <span class="text-white/70 sm:text-white/90">{{ t('features.mockup.slideshowCaptionTime') }}</span>
      </div>

      <!-- Bottom strip of thumbs -->
      <div class="absolute inset-x-3 bottom-2 z-10 flex gap-1.5 xl:inset-x-4 xl:bottom-3 xl:gap-2 3xl:inset-x-5 3xl:bottom-4 3xl:gap-3 4xl:inset-x-6">
        <div
          v-for="(photo, i) in STRIP"
          :key="photo"
          class="relative h-5 flex-1 overflow-hidden rounded-md sm:h-7 xl:h-9 2xl:h-10 3xl:h-12 4xl:h-14"
          :style="{
            background: `oklch(35% 0.04 ${hue})`,
            outline: i === 0 ? `1.5px solid oklch(92% 0.05 ${hue})` : undefined,
            outlineOffset: i === 0 ? '1px' : undefined,
          }"
        >
          <MarketingPhoto :name="photo" sizes="(min-width: 2560px) 180px, (min-width: 1920px) 155px, (min-width: 1536px) 125px, (min-width: 1280px) 108px, (min-width: 640px) 86px, 11vw" class="absolute inset-0 h-full w-full object-cover" />
        </div>
      </div>
    </div>
    <div
      v-if="isHero"
      aria-hidden="true"
      class="absolute bottom-2 left-1/2 h-3 w-3/5 -translate-x-1/2 rounded-full blur-2xl"
      :style="{ background: `oklch(40% 0.06 ${hue} / 0.55)` }"
    />
  </div>

  <!-- ───────────── Video ───────────── -->
  <div v-else-if="cardKey === 'video'" class="absolute inset-0 grid place-items-center p-4">
    <div
      class="relative h-full max-h-[190px] w-[105px] overflow-hidden rounded-[20px]"
      :style="{
        background: 'oklch(15% 0.015 280)',
        boxShadow: `0 20px 35px -18px oklch(35% 0.06 ${hue} / 0.6), inset 0 0 0 2px oklch(30% 0.03 280), inset 0 0 0 3px oklch(8% 0.01 280)`,
      }"
    >
      <div class="absolute left-1/2 top-1.5 h-1 w-7 -translate-x-1/2 rounded-full bg-black" />
      <div class="absolute inset-x-2 top-1 flex items-center justify-between text-[7px] font-medium text-white/90">
        <span>21:34</span>
        <div class="flex items-center gap-0.5">
          <Signal class="h-2 w-2" :stroke-width="2.5" />
          <Wifi class="h-2 w-2" :stroke-width="2.5" />
          <Battery class="h-2.5 w-2.5" :stroke-width="2" />
        </div>
      </div>
      <!-- The guest's selfie; anchored at 30 % so her face stays below
           the REC and timer chips when the screen is short (sm). -->
      <div class="absolute inset-1.5 top-5 bottom-10 overflow-hidden rounded-lg" :style="{ background: `oklch(35% 0.05 ${hue})` }">
        <MarketingPhoto name="mock-video-selfie" sizes="93px" position="center 30%" class="absolute inset-0 h-full w-full object-cover" />
        <div
          aria-hidden="true"
          class="absolute inset-0"
          :style="{ background: 'linear-gradient(to bottom, rgb(0 0 0 / 0.3), transparent 22%, transparent 78%, rgb(0 0 0 / 0.4))' }"
        />
        <div class="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-red-500/90 px-1.5 py-0.5 text-[7px] font-bold text-white">
          <span class="block h-1 w-1 animate-pulse rounded-full bg-white" />
          REC
        </div>
        <div class="absolute right-1.5 top-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[7px] font-semibold text-white backdrop-blur-sm">00:08</div>
        <div class="absolute inset-x-1.5 bottom-1.5 h-0.5 overflow-hidden rounded-full bg-white/25">
          <div class="h-full w-1/3" :style="{ background: `oklch(75% 0.16 ${hue + 12})` }" />
        </div>
      </div>
      <div class="absolute inset-x-0 bottom-1.5 flex justify-center">
        <div class="grid h-8 w-8 place-items-center rounded-full ring-2 ring-white/90">
          <div class="h-5 w-5 rounded-sm bg-red-500" />
        </div>
      </div>
    </div>
  </div>

  <!-- ───────────── Voice ───────────── -->
  <div v-else-if="cardKey === 'voice'" class="absolute inset-0 grid place-items-center p-4">
    <div class="flex w-full max-w-[210px] flex-col gap-2">
      <div class="flex items-center gap-2">
        <div
          class="grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold text-white"
          :style="{ background: `oklch(60% 0.16 ${hue})` }"
        >{{ senderInitial }}</div>
        <span class="text-[10px] font-medium text-(--color-foreground)">{{ t('features.mockup.voiceSender') }}</span>
        <span class="text-[9px] text-(--color-muted-foreground)">14:32</span>
      </div>
      <div
        class="relative flex items-center gap-3 rounded-2xl rounded-tl-sm p-3"
        :style="{
          background: `linear-gradient(135deg, oklch(97% 0.04 ${hue}), oklch(88% 0.09 ${hue + 6}))`,
          boxShadow: `0 12px 26px -14px oklch(60% 0.1 ${hue} / 0.45), inset 0 0 0 1px oklch(80% 0.06 ${hue} / 0.3)`,
        }"
      >
        <span
          aria-hidden="true"
          class="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white"
          :style="{
            background: `linear-gradient(135deg, oklch(65% 0.18 ${hue}), oklch(50% 0.18 ${hue - 8}))`,
            boxShadow: `0 6px 14px -4px oklch(55% 0.18 ${hue} / 0.6)`,
          }"
        >
          <Play class="h-3.5 w-3.5 fill-white" :stroke-width="0" />
        </span>
        <div class="flex flex-1 flex-col gap-1">
          <div class="flex items-center gap-[2.5px]">
            <span
              v-for="(bar, i) in voiceBars"
              :key="i"
              class="block w-[2.5px] rounded-full"
              :style="{
                height: `${bar.h}px`,
                background: bar.played
                  ? `oklch(50% 0.18 ${hue})`
                  : `oklch(75% 0.08 ${hue} / 0.55)`,
              }"
            />
          </div>
          <div class="flex items-center justify-between">
            <span class="text-[9px] font-medium text-(--color-foreground)/70">0:18 / 0:42</span>
            <span class="block h-1 w-1 rounded-full bg-(--color-primary)" />
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ───────────── Swipe ───────────── -->
  <!-- Deck and the ✕/♥ row are one centred column, so the buttons
       stay inside the stage at every card height. Decorative only:
       spans, not buttons, so they never take keyboard focus. -->
  <div v-else-if="cardKey === 'swipe'" class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4" aria-hidden="true">
    <div class="relative h-[124px] w-[100px] sm:h-[132px] sm:w-[106px] 3xl:h-[160px] 3xl:w-[128px]">
      <div
        class="absolute inset-0 -translate-y-3 scale-[0.9] rounded-xl border border-(--color-border)/60"
        :style="{
          background: `linear-gradient(135deg, oklch(90% 0.06 ${hue + 18}), oklch(76% 0.1 ${hue + 30}))`,
        }"
      />
      <div
        class="absolute inset-0 -translate-y-1.5 scale-[0.95] rounded-xl border border-(--color-border)/60"
        :style="{
          background: `linear-gradient(135deg, oklch(92% 0.06 ${hue + 8}), oklch(80% 0.1 ${hue + 16}))`,
        }"
      />
      <div
        class="absolute inset-0 overflow-hidden rounded-xl border border-(--color-border)/60"
        :style="{
          transform: 'rotate(9deg) translateX(8px)',
          boxShadow: `0 18px 32px -16px oklch(50% 0.08 ${hue} / 0.55)`,
        }"
      >
        <!-- Anchored at the top: a squat card crops the bouquet, never
             the faces under the ✓ badge. -->
        <div class="absolute inset-0" :style="{ background: `oklch(45% 0.06 ${hue})` }" />
        <MarketingPhoto
          name="mock-moderation-card"
          sizes="(min-width: 120rem) 128px, 106px"
          position="center top"
          class="absolute inset-0 h-full w-full object-cover"
        />
        <div
          aria-hidden="true"
          class="absolute inset-0"
          :style="{ background: 'linear-gradient(90deg, transparent 40%, oklch(70% 0.18 145 / 0.25) 100%)' }"
        />
        <div class="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-white/95 ring-2 ring-green-400/70 shadow-md">
          <svg viewBox="0 0 12 12" class="h-3 w-3">
            <path d="M2 6.5 L 5 9.5 L 10 3.5" stroke="oklch(55% 0.18 145)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
          </svg>
        </div>
      </div>
    </div>
    <div class="flex justify-center gap-4">
      <span class="grid h-9 w-9 place-items-center rounded-full bg-white shadow-md ring-1 ring-(--color-border)">
        <X class="h-4 w-4 text-red-500" :stroke-width="2.5" />
      </span>
      <span class="grid h-9 w-9 place-items-center rounded-full bg-white shadow-md ring-1 ring-(--color-border)">
        <Heart class="h-4 w-4 fill-(--color-primary) text-(--color-primary)" :stroke-width="2" />
      </span>
    </div>
  </div>

  <!-- ───────────── Geofence ───────────── -->
  <!-- Aerial photo of the venue, centred on the pin; a light warm wash
       pulls the pool towards the page palette without flattening the
       golden hour. The dashed radius rides on a pale halo so it reads
       over any part of the photo, even at 1× density. -->
  <div v-else-if="cardKey === 'geofence'" class="absolute inset-0 overflow-hidden">
    <div class="absolute inset-0" :style="{ background: `oklch(86% 0.07 ${hue + 10})` }" />
    <MarketingPhoto
      name="mock-venue-map"
      sizes="(min-width: 1024px) 29vw, (min-width: 640px) 46vw, 64vw"
      class="absolute inset-0 h-full w-full object-cover"
    />
    <div aria-hidden="true" class="absolute inset-0 mix-blend-color" :style="{ background: `oklch(75% 0.09 ${hue + 40})`, opacity: 0.22 }" />
    <div
      aria-hidden="true"
      class="absolute inset-0"
      :style="{ background: `radial-gradient(closest-side, oklch(97% 0.02 ${hue} / 0.3), oklch(95% 0.03 ${hue} / 0.12))` }"
    />
    <svg class="absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2" viewBox="0 0 200 200" fill="none">
      <defs>
        <radialGradient :id="`geo-fill-${hue}`" cx="50%" cy="50%" r="50%">
          <stop offset="0%" :stop-color="`oklch(70% 0.18 ${hue})`" stop-opacity="0.35" />
          <stop offset="100%" :stop-color="`oklch(70% 0.18 ${hue})`" stop-opacity="0" />
        </radialGradient>
      </defs>
      <circle cx="100" cy="100" r="78" :fill="`url(#geo-fill-${hue})`" />
      <circle cx="100" cy="100" r="78" :stroke="`oklch(98% 0.01 ${hue})`" stroke-width="3.5" opacity="0.7" />
      <circle cx="100" cy="100" r="78" :stroke="`oklch(58% 0.18 ${hue})`" stroke-width="2.25" stroke-dasharray="5 5" />
      <circle cx="100" cy="100" r="42" :stroke="`oklch(98% 0.01 ${hue})`" stroke-width="2.5" opacity="0.5" />
      <circle cx="100" cy="100" r="42" :stroke="`oklch(58% 0.16 ${hue})`" stroke-width="1.25" stroke-dasharray="2 4" opacity="0.85" />
    </svg>
    <div class="absolute left-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center">
      <div class="relative">
        <div aria-hidden="true" class="absolute inset-0 animate-ping rounded-full" :style="{ background: `oklch(60% 0.18 ${hue} / 0.35)` }" />
        <div
          class="relative grid h-10 w-10 place-items-center rounded-full text-white"
          :style="{
            background: `linear-gradient(135deg, oklch(70% 0.2 ${hue}), oklch(50% 0.2 ${hue - 8}))`,
            boxShadow: `0 8px 18px -6px oklch(50% 0.18 ${hue} / 0.7)`,
          }"
        >
          <MapPin class="h-4 w-4 fill-white" :stroke-width="0" />
        </div>
      </div>
    </div>
    <div class="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 shadow-sm backdrop-blur-sm">
      <span class="relative flex h-1.5 w-1.5">
        <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
        <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
      </span>
      <span class="text-[10px] font-medium text-(--color-foreground)">{{ t('features.mockup.geofenceActive') }}</span>
    </div>
    <div class="absolute bottom-3 right-3 rounded-md bg-white/80 px-2 py-1 text-[10px] font-medium text-(--color-foreground)/80 shadow-sm backdrop-blur-sm">
      {{ t('features.mockup.geofenceRadius') }}
    </div>
  </div>

  <!-- ───────────── Telegram ───────────── -->
  <!-- A preview of the couple's bot, which isn't live yet: its card and
       the bot's status line say «скоро». Like the real notices will, it
       names tables, never guests. -->
  <!-- Tight paddings and leading, and the first bubble's time on its
       sender line (as Telegram sets it), keep the input row whole in
       the 12rem stage (sm); the 15rem stage (3xl) gets its padding back. -->
  <div v-else-if="cardKey === 'telegram'" class="absolute inset-0 flex flex-col gap-0 p-3 sm:p-2 3xl:p-3">
    <div
      class="flex items-center gap-2 rounded-t-lg px-2.5 py-1.5"
      :style="{ background: `linear-gradient(135deg, oklch(60% 0.18 ${hue}), oklch(52% 0.2 ${hue + 8}))` }"
    >
      <div
        class="grid h-7 w-7 place-items-center rounded-full text-white"
        :style="{
          background: `linear-gradient(135deg, oklch(85% 0.1 ${hue - 4}), oklch(70% 0.16 ${hue + 6}))`,
          boxShadow: `inset 0 0 0 1.5px oklch(96% 0.02 ${hue})`,
        }"
      >
        <Send class="h-3 w-3 fill-white" :stroke-width="0" />
      </div>
      <div class="flex flex-col leading-tight">
        <span class="text-[11px] font-semibold text-white">{{ t('features.mockup.botName') }}</span>
        <span class="text-[9px] text-white/75">{{ t('features.mockup.botStatus') }}</span>
      </div>
      <div class="ml-auto flex flex-col gap-0.5">
        <span class="block h-[3px] w-3 rounded-full bg-white/60" />
        <span class="block h-[3px] w-3 rounded-full bg-white/60" />
        <span class="block h-[3px] w-3 rounded-full bg-white/60" />
      </div>
    </div>
    <div
      class="relative flex flex-1 flex-col gap-1 rounded-b-lg p-1.5"
      :style="{
        background: `radial-gradient(120% 100% at 50% 0%, oklch(96% 0.015 ${hue}) 0%, oklch(94% 0.01 240) 100%)`,
      }"
    >
      <div class="self-start max-w-[85%] rounded-xl rounded-bl-sm bg-white px-2.5 py-1 leading-tight shadow-sm">
        <div class="flex items-center gap-1 text-[10px] font-semibold text-(--color-foreground)">
          <span class="grid h-3 w-3 place-items-center rounded-full text-[8px]" :style="{ background: `oklch(85% 0.14 ${hue + 30})` }">📷</span>
          {{ t('features.mockup.botNotifyTitle') }}
        </div>
        <div class="mt-0.5 flex items-baseline justify-between gap-2 text-(--color-muted-foreground)">
          <span class="text-[9px]">{{ t('features.mockup.botNotifyBy') }}</span>
          <span class="text-[8px]">14:38</span>
        </div>
      </div>
      <!-- One row of 4 thumbs keeps the whole chat inside a 12rem stage. -->
      <div class="self-start w-[146px] max-w-[90%] rounded-xl rounded-bl-sm bg-white p-1 shadow-sm">
        <div class="grid grid-cols-4 gap-0.5 overflow-hidden rounded-md">
          <div
            v-for="photo in ALBUM"
            :key="photo"
            class="relative aspect-square overflow-hidden"
            :style="{ background: 'oklch(90% 0.03 60)' }"
          >
            <MarketingPhoto :name="photo" sizes="34px" class="absolute inset-0 h-full w-full object-cover" />
          </div>
        </div>
        <div class="mt-1 flex items-center justify-between px-0.5 text-[9px] leading-tight">
          <span class="font-medium text-(--color-foreground)">{{ t('features.mockup.botArchiveCaption') }}</span>
          <span class="text-(--color-muted-foreground)">14:38</span>
        </div>
      </div>
      <div class="mt-auto flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 shadow-inner ring-1 ring-(--color-border)/50">
        <span class="text-[9px] text-(--color-muted-foreground)/60">{{ t('features.mockup.botInputPlaceholder') }}</span>
        <div class="ml-auto grid h-4 w-4 place-items-center rounded-full text-white" :style="{ background: `oklch(60% 0.18 ${hue})` }">
          <Send class="h-2 w-2 fill-white" :stroke-width="0" />
        </div>
      </div>
    </div>
  </div>
</template>
