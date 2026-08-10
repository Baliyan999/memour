<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '#imports'
import { Battery, Heart, MapPin, Play, Send, Signal, Wifi, X } from '@lucide/vue'

/**
 * Mockup — small UI mock specific to each feature. Pure CSS/SVG, no
 * scroll/state subscriptions. Each variant is a stylised reproduction
 * of the real product UI for that feature (projector slideshow, phone
 * recording, voice bubble, swipe deck, geofence map, Telegram chat).
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
</script>

<template>
  <!-- ───────────── Slideshow (Hero) ───────────── -->
  <div v-if="cardKey === 'slideshow'" class="absolute inset-0 grid place-items-center p-6 sm:p-8">
    <div
      class="relative aspect-[16/9] w-full max-w-[480px] overflow-hidden rounded-xl border border-(--color-border)/70"
      :style="{
        background: 'oklch(18% 0.02 280)',
        boxShadow: `0 40px 70px -30px oklch(50% 0.1 ${hue} / 0.5), 0 0 0 6px oklch(15% 0.015 280), 0 0 0 7px oklch(40% 0.04 280)`,
      }"
    >
      <!-- Top bar -->
      <div class="absolute inset-x-0 top-0 z-10 flex items-center gap-2 px-3 py-2">
        <div class="flex items-center gap-1.5 rounded-full bg-red-500/20 px-2 py-0.5 ring-1 ring-red-400/50">
          <span class="relative flex h-1.5 w-1.5">
            <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
          </span>
          <span class="text-[9px] font-semibold uppercase tracking-wider text-red-200">Live</span>
        </div>
        <span class="text-[10px] text-white/50">{{ t('features.mockup.slideshowVenue') }}</span>
        <span class="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-sm">247</span>
      </div>

      <!-- Stage with the now-playing photo -->
      <div class="absolute inset-x-4 bottom-12 top-9 overflow-hidden rounded-md">
        <img src="/images/slideshow-hero.webp" class="absolute inset-0 h-full w-full object-cover" alt="Slideshow hero" />
        <div class="absolute left-2 bottom-2 rounded-full bg-black/45 px-2 py-0.5 text-[9px] text-white/90 backdrop-blur-sm">
          {{ t('features.mockup.slideshowCaption') }}
        </div>
      </div>

      <!-- Bottom strip of thumbs -->
      <div class="absolute inset-x-3 bottom-2 flex gap-1.5">
        <div
          v-for="(h, i) in [hue + 0, hue + 10, hue + 22, hue - 6, hue + 32]"
          :key="i"
          class="relative h-7 flex-1 overflow-hidden rounded-md"
          :style="{
            background: `linear-gradient(135deg, oklch(82% 0.1 ${h}), oklch(60% 0.15 ${h + 12}))`,
            outline: i === 0 ? `1.5px solid oklch(92% 0.05 ${hue})` : undefined,
            outlineOffset: i === 0 ? '1px' : undefined,
          }"
        >
          <span
            class="absolute rounded-full"
            :style="{
              width: `${14 + (i % 2) * 4}px`,
              height: `${14 + (i % 2) * 4}px`,
              bottom: '-3px',
              left: `${6 + i * 2}px`,
              background: 'oklch(28% 0.04 280 / 0.65)',
            }"
          />
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
      <div class="absolute inset-1.5 top-5 bottom-10 overflow-hidden rounded-lg">
        <div
          class="absolute inset-0"
          :style="{
            background: `radial-gradient(circle at 50% 38%, oklch(82% 0.13 ${hue + 18}) 0%, oklch(60% 0.16 ${hue + 6}) 55%, oklch(35% 0.1 ${hue - 4}) 100%)`,
          }"
        />
        <svg class="absolute inset-0 h-full w-full" viewBox="0 0 80 100" preserveAspectRatio="xMidYMax slice">
          <ellipse cx="40" cy="42" rx="13" ry="15" fill="oklch(25% 0.04 280 / 0.85)" />
          <path d="M18 100 L18 80 Q18 62 40 60 Q62 62 62 80 L62 100 Z" fill="oklch(25% 0.04 280 / 0.85)" />
        </svg>
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
        <button
          aria-hidden="true"
          class="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white"
          :style="{
            background: `linear-gradient(135deg, oklch(65% 0.18 ${hue}), oklch(50% 0.18 ${hue - 8}))`,
            boxShadow: `0 6px 14px -4px oklch(55% 0.18 ${hue} / 0.6)`,
          }"
        >
          <Play class="h-3.5 w-3.5 fill-white" :stroke-width="0" />
        </button>
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
  <div v-else-if="cardKey === 'swipe'" class="absolute inset-0 grid place-items-center p-4">
    <div class="relative h-[170px] w-[135px]">
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
        <div
          class="absolute inset-0"
          :style="{
            background: `radial-gradient(120% 100% at 40% 30%, oklch(85% 0.12 ${hue + 16}) 0%, oklch(72% 0.16 ${hue + 6}) 50%, oklch(48% 0.12 ${hue - 6}) 100%)`,
          }"
        />
        <svg class="absolute inset-0 h-full w-full" viewBox="0 0 100 120" preserveAspectRatio="xMidYMax slice">
          <ellipse cx="38" cy="55" rx="10" ry="12" fill="oklch(25% 0.04 280 / 0.85)" />
          <path d="M22 120 L22 95 Q22 78 38 76 Q54 78 54 95 L54 120 Z" fill="oklch(25% 0.04 280 / 0.85)" />
          <ellipse cx="64" cy="60" rx="9" ry="11" fill="oklch(25% 0.04 280 / 0.9)" />
          <path d="M50 120 L50 98 Q50 82 64 80 Q78 82 78 98 L78 120 Z" fill="oklch(25% 0.04 280 / 0.9)" />
        </svg>
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
      <div class="absolute inset-x-0 -bottom-12 flex justify-center gap-4">
        <button aria-hidden="true" class="grid h-10 w-10 place-items-center rounded-full bg-white shadow-md ring-1 ring-(--color-border)">
          <X class="h-4 w-4 text-red-500" :stroke-width="2.5" />
        </button>
        <button aria-hidden="true" class="grid h-10 w-10 place-items-center rounded-full bg-white shadow-md ring-1 ring-(--color-border)">
          <Heart class="h-4 w-4 fill-(--color-primary) text-(--color-primary)" :stroke-width="2" />
        </button>
      </div>
    </div>
  </div>

  <!-- ───────────── Geofence ───────────── -->
  <div v-else-if="cardKey === 'geofence'" class="absolute inset-0 overflow-hidden">
    <div
      class="absolute inset-0"
      :style="{
        background: `linear-gradient(160deg, oklch(95% 0.03 ${hue}), oklch(86% 0.07 ${hue + 10}))`,
      }"
    />
    <svg class="absolute inset-0 h-full w-full" viewBox="0 0 300 240" preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern :id="`dots-${hue}`" x="0" y="0" width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.6" :fill="`oklch(70% 0.06 ${hue})`" opacity="0.35" />
        </pattern>
      </defs>
      <rect width="300" height="240" :fill="`url(#dots-${hue})`" />
      <path d="M-10 130 Q 80 110, 150 130 T 320 120" :stroke="`oklch(98% 0.01 ${hue})`" stroke-width="14" fill="none" stroke-linecap="round" />
      <path d="M-10 130 Q 80 110, 150 130 T 320 120" :stroke="`oklch(85% 0.04 ${hue})`" stroke-width="1" fill="none" stroke-dasharray="6 6" />
      <path d="M180 -10 Q 170 80, 200 150 T 220 260" :stroke="`oklch(98% 0.01 ${hue})`" stroke-width="10" fill="none" stroke-linecap="round" />
      <g :fill="`oklch(80% 0.06 ${hue})`" opacity="0.55">
        <rect x="40" y="40" width="35" height="28" rx="3" />
        <rect x="85" y="48" width="25" height="22" rx="3" />
        <rect x="40" y="170" width="40" height="32" rx="3" />
        <rect x="230" y="50" width="30" height="40" rx="3" />
        <rect x="240" y="180" width="32" height="24" rx="3" />
      </g>
    </svg>
    <svg class="absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2" viewBox="0 0 200 200" fill="none">
      <defs>
        <radialGradient :id="`geo-fill-${hue}`" cx="50%" cy="50%" r="50%">
          <stop offset="0%" :stop-color="`oklch(70% 0.18 ${hue})`" stop-opacity="0.25" />
          <stop offset="100%" :stop-color="`oklch(70% 0.18 ${hue})`" stop-opacity="0" />
        </radialGradient>
      </defs>
      <circle cx="100" cy="100" r="78" :fill="`url(#geo-fill-${hue})`" />
      <circle cx="100" cy="100" r="78" :stroke="`oklch(58% 0.18 ${hue})`" stroke-width="1.5" stroke-dasharray="5 5" opacity="0.9" />
      <circle cx="100" cy="100" r="42" :stroke="`oklch(65% 0.14 ${hue})`" stroke-width="1" stroke-dasharray="2 4" opacity="0.55" />
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
  <div v-else-if="cardKey === 'telegram'" class="absolute inset-0 flex flex-col gap-0 p-3">
    <div
      class="flex items-center gap-2 rounded-t-lg px-2.5 py-2"
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
      class="relative flex flex-1 flex-col gap-1.5 rounded-b-lg p-2"
      :style="{
        background: `radial-gradient(120% 100% at 50% 0%, oklch(96% 0.015 ${hue}) 0%, oklch(94% 0.01 240) 100%)`,
      }"
    >
      <div class="self-start max-w-[85%] rounded-xl rounded-bl-sm bg-white px-2.5 py-1.5 shadow-sm">
        <div class="flex items-center gap-1 text-[10px] font-semibold text-(--color-foreground)">
          <span class="grid h-3 w-3 place-items-center rounded-full text-[8px]" :style="{ background: `oklch(85% 0.14 ${hue + 30})` }">📷</span>
          {{ t('features.mockup.botNotifyTitle') }}
        </div>
        <div class="mt-0.5 text-[9px] text-(--color-muted-foreground)">{{ t('features.mockup.botNotifyBy') }}</div>
        <div class="mt-0.5 flex items-center justify-end gap-0.5 text-[8px] text-(--color-muted-foreground)">14:38</div>
      </div>
      <div class="self-start max-w-[90%] rounded-xl rounded-bl-sm bg-white p-1.5 shadow-sm">
        <div class="grid grid-cols-3 gap-0.5 overflow-hidden rounded-md">
          <div
            v-for="(h, i) in [hue + 0, hue + 14, hue - 6, hue + 22, hue + 6, hue - 12]"
            :key="i"
            class="relative aspect-square overflow-hidden"
            :style="{ background: `linear-gradient(135deg, oklch(82% 0.1 ${h}), oklch(60% 0.15 ${h + 12}))` }"
          >
            <span
              class="absolute rounded-full"
              :style="{
                width: `${7 + (i % 2) * 2}px`,
                height: `${7 + (i % 2) * 2}px`,
                bottom: '-1px',
                left: `${2 + (i % 3)}px`,
                background: 'oklch(25% 0.04 280 / 0.65)',
              }"
            />
          </div>
        </div>
        <div class="mt-1 flex items-center justify-between px-0.5 text-[9px]">
          <span class="font-medium text-(--color-foreground)">{{ t('features.mockup.botArchiveCaption') }}</span>
          <span class="text-(--color-muted-foreground)">14:38</span>
        </div>
      </div>
      <div class="mt-auto flex items-center gap-1.5 rounded-full bg-white px-2 py-1 shadow-inner ring-1 ring-(--color-border)/50">
        <span class="text-[9px] text-(--color-muted-foreground)/60">{{ t('features.mockup.botInputPlaceholder') }}</span>
        <div class="ml-auto grid h-4 w-4 place-items-center rounded-full text-white" :style="{ background: `oklch(60% 0.18 ${hue})` }">
          <Send class="h-2 w-2 fill-white" :stroke-width="0" />
        </div>
      </div>
    </div>
  </div>
</template>
