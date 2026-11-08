<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from '#imports'
import { Check, ExternalLink } from '@lucide/vue'
import {
  GEOFENCE_RADII,
  GEOFENCE_RADIUS_MAX,
  GEOFENCE_RADIUS_MIN,
  GEOFENCE_SLACK_M,
  formatLatLng,
  mapCheckUrl,
  parseVenueLocation,
} from '#shared/geofence'

/**
 * The soft geofence block of the admin event forms (create, edit).
 *
 * A switch, off by default. On: where the venue is — plain coordinates
 * or a Google / Yandex Maps link, read by shared/geofence.ts as it is
 * typed — the radius, and one line on what a guest outside it gets
 * (true to server/api/guest/upload.post.ts). No map SDK: the point that
 * was read opens in Google Maps, to check it by eye.
 *
 * The parent owns the values and validates them on submit with the
 * same parser.
 */
const enabled = defineModel<boolean>('enabled', { required: true })
const location = defineModel<string>('location', { required: true })
const radius = defineModel<number>('radius', { required: true })

const { t } = useI18n()
const titleId = useId()
const hintId = useId()

const parsed = computed(() => parseVenueLocation(location.value))

// A radius saved outside the offered ones (set by hand) stays on offer,
// so opening and saving the form never changes it silently.
const radii = computed(() => {
  const list: number[] = [...GEOFENCE_RADII]
  const r = radius.value
  if (!list.includes(r) && r >= GEOFENCE_RADIUS_MIN && r <= GEOFENCE_RADIUS_MAX) list.push(r)
  return list.sort((a, b) => a - b)
})
</script>

<template>
  <div class="flex flex-col gap-3 rounded-(--radius-lg) border border-(--color-border) bg-white/60 p-4">
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0 flex-1">
        <p :id="titleId" class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">{{ t('admin.eventForm.geofence') }}</p>
        <p v-if="!enabled" class="mt-1 text-[0.6875rem] text-(--color-muted-foreground)">{{ t('admin.eventForm.geofenceOff') }}</p>
      </div>
      <button
        type="button"
        role="switch"
        data-testid="geofence-switch"
        :aria-checked="enabled"
        :aria-labelledby="titleId"
        :class="[
          'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors duration-(--spring-snappy) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring) focus-visible:ring-offset-2',
          enabled ? 'bg-(--color-primary)' : 'bg-(--color-muted-foreground)/30',
        ]"
        @click="enabled = !enabled"
      >
        <span
          aria-hidden="true"
          :class="[
            'block h-6 w-6 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0_/_0.2)] transition-transform duration-(--spring-snappy) ease-(--ease-spring) motion-reduce:transition-none',
            enabled ? 'translate-x-5' : 'translate-x-0',
          ]"
        />
      </button>
    </div>

    <Transition
      enter-active-class="transition-[opacity,translate] duration-(--spring-default) ease-(--ease-spring) motion-reduce:transition-opacity motion-reduce:duration-150"
      enter-from-class="opacity-0 -translate-y-1 motion-reduce:translate-y-0"
      leave-active-class="transition-opacity duration-150"
      leave-to-class="opacity-0"
    >
      <div v-if="enabled" class="flex flex-col gap-4">
        <div class="flex flex-col gap-1.5">
          <label for="ev-geo-location" class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">{{ t('admin.eventForm.geofenceLocation') }}</label>
          <input
            id="ev-geo-location"
            v-model="location"
            type="text"
            inputmode="url"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            maxlength="2048"
            :placeholder="t('admin.eventForm.geofenceLocationPlaceholder')"
            :aria-describedby="hintId"
            class="h-11 min-w-0 rounded-md border border-(--color-border) bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)"
          >
          <div :id="hintId" class="text-[0.6875rem] leading-relaxed" aria-live="polite">
            <p v-if="parsed.ok" class="flex flex-wrap items-center gap-x-2 gap-y-1 text-(--color-foreground)">
              <Check class="h-3.5 w-3.5 shrink-0 text-emerald-600" :stroke-width="2.2" aria-hidden="true" />
              <span class="tabular-nums">{{ t('admin.eventForm.geofencePoint', { point: formatLatLng(parsed.point) }) }}</span>
              <a
                :href="mapCheckUrl(parsed.point)"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1 text-(--color-primary) underline decoration-(--color-primary)/40 underline-offset-2 hover:decoration-current"
              >{{ t('admin.eventForm.geofenceCheckMap') }}<ExternalLink class="h-3 w-3" aria-hidden="true" /></a>
            </p>
            <p v-else-if="parsed.reason === 'short_link'" class="text-amber-700">{{ t('admin.eventForm.geofenceShortLink') }}</p>
            <p v-else-if="parsed.reason === 'not_found'" class="text-amber-700">{{ t('admin.eventForm.geofenceNotFound') }}</p>
            <p v-else class="text-(--color-muted-foreground)">{{ t('admin.eventForm.geofenceLocationHint') }}</p>
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <span id="ev-geo-radius" class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">{{ t('admin.eventForm.geofenceRadius') }}</span>
          <div class="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="ev-geo-radius">
            <button
              v-for="r in radii"
              :key="r"
              type="button"
              role="radio"
              :aria-checked="radius === r"
              :class="[
                'min-h-9 rounded-full border px-3.5 text-xs tabular-nums transition-[transform,background-color,color] duration-150 active:scale-95 motion-reduce:transition-colors motion-reduce:active:scale-100',
                radius === r
                  ? 'border-(--color-primary) bg-(--color-primary) text-(--color-primary-foreground)'
                  : 'border-(--color-border) bg-white text-(--color-muted-foreground) hover:text-(--color-foreground)',
              ]"
              @click="radius = r"
            >{{ t('admin.eventForm.geofenceMeters', { n: r }) }}</button>
          </div>
        </div>

        <p class="text-[0.6875rem] leading-relaxed text-(--color-muted-foreground)">
          {{ t('admin.eventForm.geofenceExplain', { slack: GEOFENCE_SLACK_M }) }}
        </p>
      </div>
    </Transition>
  </div>
</template>
