<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vue-router'
import { motion, AnimatePresence, useReducedMotion } from 'motion-v'
import { Check, Users } from '@lucide/vue'
import { useI18n, useSwitchLocalePath } from '#imports'

definePageMeta({ layout: 'guest' })

const { t, locale } = useI18n()
const switchLocalePath = useSwitchLocalePath()
const { consentFor } = useLegal()
const errorMessage = useErrorMessage('guest')
const { toast } = useToast()
const otherLocale = computed<'ru' | 'uz'>(() => (locale.value === 'ru' ? 'uz' : 'ru'))
const otherLocaleLabel = computed(() => (locale.value === 'ru' ? "O'zbekcha" : 'Русский'))

/**
 * /e/[id] — public landing for wedding guests.
 *
 * Flow (per device):
 *   1. Scan QR → land here with `?t=N` (table number baked into the QR).
 *   2. Outside the upload window (see server/utils/upload-window.ts)
 *      the guest gets a "opens at … / closed" card before anything
 *      else — never a camera whose shots will be refused.
 *   3. We generate / read a persistent device_id (localStorage) and ask
 *      the server for the existing binding. Three branches:
 *        a) No binding yet → show welcome card (only "your name"),
 *           table is locked from the URL and displayed as a gold badge.
 *        b) Binding matches `t` → skip welcome, jump straight to
 *           camera with the stored name.
 *        c) Binding to a different table that already has uploads →
 *           polite "device already locked" screen with a way back to
 *           that table. (No uploads yet → welcome again; the server
 *           moves the binding.)
 *   4. Camera/video/voice components get device_id + table; every
 *      upload counts against a per-device quota for the event's tier
 *      (see server/utils/guest-quota.ts). Modes the tier doesn't
 *      include aren't shown; a used-up mode shows a "done" card.
 *   5. The tier also caps how many phones join the event (shared/
 *      plans.ts). A phone that isn't bound yet while the event is full
 *      (`guests_full`, or the server's 409 guest_limit_reached) gets a
 *      friendly "all places are taken" card instead of the welcome
 *      form; phones already in are never affected. The first paint
 *      can't tell which one this phone is (no device_id on the server),
 *      so on a full event it shows a neutral placeholder until the
 *      device check on mount decides.
 *
 * The table number can NEVER be edited from the UI any more — it is
 * strictly the one written into the QR code by the admin.
 *
 * Before the first upload from a device to an event the welcome screen
 * shows a short notice (who sees the files, how long they are kept)
 * and two unticked boxes: guest rules + licence, privacy policy. They
 * go to the server with the binding and are recorded there; uploads
 * without them are refused (`consent_required`), and a device that
 * hasn't accepted the current versions lands on the welcome screen
 * even when it is already bound (`consented` from the event API). If
 * an upload is refused that way mid-shoot (the texts changed while the
 * page was open), the frame stays in review and the same notice opens
 * as a sheet over the camera; accepting there sends the frame.
 */
const route = useRoute()
const eventId = computed(() => route.params.id as string)
const tableParam = computed(() => {
  const t = route.query.t
  const n = typeof t === 'string' ? parseInt(t, 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
})

const { id: deviceId, ensure: ensureDeviceId } = useDeviceId()

type Binding = {
  table_number: number
  guest_name: string | null
  photo_count: number
  video_count: number
  voice_count: number
}

type Limits = { photo: number; video: number; voice: number }

type UploadWindowInfo = {
  opens_at: string | null
  closes_at: string | null
  state: 'before' | 'open' | 'after'
  server_now: string
}

type EventResp = {
  event: {
    id: string
    couple_names: string
    wedding_date: string
    venue_name: string | null
    venue_lat: number | null
    venue_lng: number | null
    geofence_radius: number | null
    status: string
    plan_tier: string | null
    table_count: number | null
    archive_expires_at: string | null
    branding: {
      bride_name: string | null
      groom_name: string | null
      cover_photo: string | null
      accent_color: string | null
      greeting_text: string | null
    } | null
  }
  binding: Binding | null
  consented: boolean
  guests_full: boolean
  limits: Limits
  upload_window: UploadWindowInfo
}

// Initial fetch (SSR-safe): no device_id, so we won't get a binding —
// that's fine. We re-fetch on mount once the device_id is known.
const { data, error: fetchError, pending, refresh } = await useFetch<EventResp>(
  () => `/api/guest/event/${eventId.value}`,
  { retry: 1, timeout: 10_000 },
)

// 404 / 410 vs "our server hiccuped": only the first two mean the QR
// is wrong or the album is closed. A 5xx or timeout during the party
// gets a retry button instead of "this link is wrong".
const fetchErrorKind = computed<'not_found' | 'archived' | 'temporary' | null>(() => {
  const status = fetchError.value?.statusCode
  if (!fetchError.value) return null
  if (status === 404 || status === 400) return 'not_found'
  if (status === 410) return 'archived'
  return 'temporary'
})
if (import.meta.server && (fetchError.value?.statusCode === 404 || fetchError.value?.statusCode === 410)) {
  const reqEvent = useRequestEvent()
  if (reqEvent) setResponseStatus(reqEvent, fetchError.value.statusCode)
}
const retrying = ref(false)
async function retryFetch() {
  retrying.value = true
  try { await refresh() } finally { retrying.value = false }
}

const ev = computed(() => data.value?.event ?? null)
const binding = ref<Binding | null>(data.value?.binding ?? null)
// Guest rules / licence / privacy accepted on this device for this event.
const consented = ref(data.value?.consented ?? false)
const acceptRules = ref(false)
const acceptPrivacy = ref(false)
const consentError = ref<string | null>(null)
const limits = ref<Limits>(data.value?.limits ?? { photo: 20, video: 0, voice: 0 })
const uploadWindow = ref<UploadWindowInfo | null>(data.value?.upload_window ?? null)
// The event already has as many guests as its tier takes — only
// matters while this phone isn't bound (see decideStage). Taken from
// the first paint (for the placeholder) and then only from answers that
// carried this phone's device_id (refreshBinding): a plain refresh()
// can't tell a phone already in from a new one.
const guestsFull = ref(data.value?.guests_full ?? false)
watch(
  () => data.value,
  (next) => {
    if (next?.binding) binding.value = next.binding
    if (next) consented.value = next.consented
    if (next?.limits) limits.value = next.limits
    if (next?.upload_window) uploadWindow.value = next.upload_window
  },
)

const isActive = computed(() => ev.value?.status === 'active')
const isDraft = computed(() => ev.value?.status === 'draft')
const geofenceEnabled = computed(() => ev.value?.venue_lat != null && ev.value?.venue_lng != null)

// --- Upload window ----------------------------------------------------
// The server says where "now" is relative to the window; on the client
// we keep ticking with the server clock (skew-corrected) so a guest
// who opened the page at 17:50 the day before sees it open at 18:00.
const serverSkewMs = ref(0)
const nowTick = ref(Date.now())
const windowClosedByServer = ref(false)
const windowState = computed<'before' | 'open' | 'after'>(() => {
  const w = uploadWindow.value
  if (!w) return 'open'
  if (windowClosedByServer.value) return 'after'
  if (!w.opens_at || !w.closes_at) return w.state
  const now = nowTick.value + serverSkewMs.value
  if (now < Date.parse(w.opens_at)) return 'before'
  if (now >= Date.parse(w.closes_at)) return 'after'
  return 'open'
})

const tableOutOfRange = computed(() => {
  const count = ev.value?.table_count
  return !!(count && tableParam.value && tableParam.value > count)
})

type Stage = 'checking' | 'welcome' | 'camera' | 'wrong_table' | 'no_table' | 'quota_full' | 'window_before' | 'window_after' | 'guest_limit'
// First render (SSR and hydration) only uses what the server sent, so
// both sides agree; decideStage() refines it on mount. On a full event
// the server can't know yet whether this phone is already in (camera)
// or new (all places taken) — a neutral placeholder until it does,
// never a name form that would be taken away.
function initialStage(): Stage {
  const s = uploadWindow.value?.state
  if (s === 'before') return 'window_before'
  if (s === 'after') return 'window_after'
  if (!tableParam.value || tableOutOfRange.value) return 'no_table'
  if (guestsFull.value) return 'checking'
  return 'welcome'
}

const guestName = ref('')
const stage = ref<Stage>(initialStage())

// The welcome blocks fade in when the stage changes on the client, but
// the server-rendered first paint must be visible: motion-v writes the
// `initial` state inline, and on slow 4G the names, table and name
// field sat at opacity 0 for seconds until the JS arrived.
const hydrated = ref(false)
onMounted(() => { hydrated.value = true })

type Mode = 'photo' | 'video' | 'voice'
const mode = ref<Mode>('photo')

// Modes come from the tier limits the server sends (0 = not in plan).
const availableModes = computed<Mode[]>(() => (['photo', 'video', 'voice'] as Mode[]).filter((m) => limits.value[m] > 0))
const showModeTabs = computed(() => availableModes.value.length > 1)

// A capture component with a frame in review / on its way: switching
// modes would unmount it and lose that frame, so the dock locks.
const captureBusy = ref(false)

// Counters drive the "X / N" chips on the camera screen. Start from the
// last value the server returned; each upload bumps them.
const counts = ref({
  photo_count: binding.value?.photo_count ?? 0,
  video_count: binding.value?.video_count ?? 0,
  voice_count: binding.value?.voice_count ?? 0,
})
watch(binding, (b) => {
  if (b) {
    counts.value = {
      photo_count: b.photo_count,
      video_count: b.video_count,
      voice_count: b.voice_count,
    }
  }
})

function usedFor(m: Mode): number {
  return m === 'photo' ? counts.value.photo_count : m === 'video' ? counts.value.video_count : counts.value.voice_count
}
function exhausted(m: Mode): boolean {
  return usedFor(m) >= limits.value[m]
}
const allExhausted = computed(() => availableModes.value.length > 0 && availableModes.value.every(exhausted))
const modeExhausted = computed(() => exhausted(mode.value))
const modesLeft = computed(() => availableModes.value.filter((m) => m !== mode.value && !exhausted(m)))

function modeTabClass(m: Mode): string {
  return [
    'flex flex-1 touch-manipulation flex-col items-center gap-0.5 rounded-full px-2 py-2 text-xs transition-colors disabled:opacity-40',
    mode.value === m
      ? 'bg-(--color-primary) text-(--color-primary-foreground)'
      : 'text-(--color-muted-foreground) hover:text-(--color-foreground)',
  ].join(' ')
}

function selectMode(m: Mode) {
  if (captureBusy.value && mode.value !== m) return
  mode.value = m
}

// Routing decision once we know device_id, table, window and binding.
function decideStage() {
  // Never yank the screen from under a guest mid-shot; re-run when the
  // capture component settles (see the captureBusy watcher).
  if (stage.value === 'camera' && captureBusy.value) return
  if (windowState.value === 'before') {
    stage.value = 'window_before'
    return
  }
  if (windowState.value === 'after') {
    stage.value = 'window_after'
    return
  }
  if (!tableParam.value || tableOutOfRange.value) {
    stage.value = 'no_table'
    return
  }
  const b = binding.value
  if (b && b.table_number !== tableParam.value) {
    // Locked only once something was sent from that table; a device
    // that only typed its name at the wrong QR just starts over here.
    if (b.photo_count + b.video_count + b.voice_count > 0) {
      stage.value = 'wrong_table'
      return
    }
    if (b.guest_name && !guestName.value) guestName.value = b.guest_name
    stage.value = 'welcome'
    return
  }
  if (b && !consented.value) {
    // Bound before the consent screen existed (or the texts changed):
    // ask once more before the camera.
    if (b.guest_name && !guestName.value) guestName.value = b.guest_name
    stage.value = 'welcome'
    return
  }
  if (b) {
    // We already know this guest. Carry forward their name and skip
    // the welcome form entirely.
    if (b.guest_name) guestName.value = b.guest_name
    stage.value = allExhausted.value ? 'quota_full' : 'camera'
    if (!availableModes.value.includes(mode.value)) mode.value = 'photo'
    return
  }
  // A new phone: welcome — unless every place is taken already.
  stage.value = guestsFull.value ? 'guest_limit' : 'welcome'
}

/** The server refused this phone a place: the event is full. */
function showGuestLimit() {
  guestsFull.value = true
  binding.value = null
  captureBusy.value = false
  stage.value = 'guest_limit'
}

async function refreshBinding() {
  if (!deviceId.value) return
  const fresh = await $fetch<EventResp>(`/api/guest/event/${eventId.value}`, {
    query: { device_id: deviceId.value },
  })
  serverSkewMs.value = Date.parse(fresh.upload_window.server_now) - Date.now()
  nowTick.value = Date.now()
  // The event too: decideStage() reads its table count.
  data.value = fresh
  binding.value = fresh.binding
  consented.value = fresh.consented
  guestsFull.value = fresh.guests_full
  limits.value = fresh.limits
  uploadWindow.value = fresh.upload_window
}

const LOCALE_KEY = 'memour:guest-locale'
function rememberLocale(l: 'ru' | 'uz') {
  try { localStorage.setItem(LOCALE_KEY, l) } catch { /* private mode */ }
}

let tickTimer: ReturnType<typeof setInterval> | undefined

onMounted(async () => {
  // QR codes always point at /uz/…; a guest who switched to Russian
  // on an earlier visit gets Russian again when they re-scan.
  try {
    const saved = localStorage.getItem(LOCALE_KEY)
    if ((saved === 'ru' || saved === 'uz') && saved !== locale.value) {
      await navigateTo(switchLocalePath(saved), { replace: true })
      return
    }
  } catch { /* storage blocked — stay on the QR's language */ }

  ensureDeviceId()
  // Re-fetch the event WITH device_id so the server can attach the
  // existing binding (the SSR pass didn't have device_id yet).
  try {
    await refreshBinding()
  } catch {
    // swallow — we still have the SSR response; binding stays null.
    // Its guests_full can't tell a phone already in from a new one, so
    // show the form and let the binding endpoint decide (a new phone on
    // a full event gets guest_limit_reached there).
    guestsFull.value = false
  }
  decideStage()
  tickTimer = setInterval(() => { nowTick.value = Date.now() }, 20_000)
})

// Leaving (reload, back, closing the tab) with a frame in review or
// on its way would drop it silently; let the browser ask first.
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!captureBusy.value) return
  e.preventDefault()
  e.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))

onBeforeUnmount(() => {
  clearInterval(tickTimer)
  clearTimeout(sentTimer)
  window.removeEventListener('beforeunload', onBeforeUnload)
})

watch([tableParam, binding, windowState, allExhausted], decideStage)
watch(captureBusy, (busy) => { if (!busy) decideStage() })

const welcomePending = ref(false)

const consentReady = computed(() => consented.value || (acceptRules.value && acceptPrivacy.value))

async function startCapture() {
  if (welcomePending.value) return
  if (!guestName.value.trim() || !tableParam.value || !deviceId.value || !consentReady.value) return
  welcomePending.value = true
  consentError.value = null
  // Persist locally as a UX nicety.
  try {
    localStorage.setItem(`memour:guest:${eventId.value}`, guestName.value.trim())
  } catch {/* ignore */}

  // Record the binding on the server NOW, not on first upload. This
  // way a guest who scans, enters their name, then closes the tab
  // (or wanders off and comes back later) jumps straight back to
  // the camera — the server already knows who they are.
  try {
    const res = await $fetch<{ ok: boolean; binding: Binding }>(
      `/api/guest/binding/${eventId.value}`,
      {
        method: 'POST',
        body: {
          device_id: deviceId.value,
          guest_name: guestName.value.trim(),
          guest_table: tableParam.value,
          consent: consented.value ? undefined : consentFor('guest_upload'),
          locale: locale.value,
        },
      },
    )
    consented.value = true
    binding.value = res.binding
    decideStage()
  } catch (e: any) {
    const code = e?.data?.data?.code ?? e?.data?.code
    if (code === 'wrong_table') {
      // Stale binding for this device points at a different table —
      // server-side check beats client-side guesswork. Load it so the
      // lock screen can name the table; show the screen either way.
      await refreshBinding().catch(() => {})
      stage.value = 'wrong_table'
    } else if (code === 'invalid_table') {
      stage.value = 'no_table'
    } else if (code === 'guest_limit_reached') {
      showGuestLimit()
    } else if (code === 'window_closed') {
      windowClosedByServer.value = true
    } else if (code === 'window_not_open') {
      // Our clock ran ahead of the server's. Take its time again; if we
      // still think the window is open, say it here and let them retry.
      await refreshBinding().catch(() => {})
      decideStage()
      if (stage.value === 'welcome') consentError.value = errorMessage(code)
    } else if (code === 'event_not_active') {
      await refresh()
    } else if (code === 'consent_required' || code === 'consent_outdated') {
      // Stay on the welcome screen: the boxes are what's missing.
      consented.value = false
      consentError.value = errorMessage(code)
    } else if (!consented.value) {
      // Without the recorded consent every upload would be refused —
      // keep the guest here and let them try again.
      console.error('[guest/welcome] binding failed', e)
      consentError.value = errorMessage(e, { fallback: 'guest.errors.upload_failed' })
    } else {
      // Soft failure (network blip, server hiccup): let them in
      // anyway. The upload endpoint also creates the binding as a
      // safety net, so they're not stranded.
      console.error('[guest/welcome] binding failed', e)
      binding.value ??= {
        table_number: tableParam.value,
        guest_name: guestName.value.trim(),
        ...counts.value,
      }
      stage.value = allExhausted.value ? 'quota_full' : 'camera'
    }
  } finally {
    welcomePending.value = false
  }
}

// --- "Sent" moment ----------------------------------------------------
// A small pill that springs in at the top after every successful
// upload and leaves the way it came. A second upload while it is up
// just updates the text and restarts the timer — no re-entry.
const reduceMotion = useReducedMotion()
const pillSpring = computed(() => (reduceMotion.value
  ? { duration: 0.15 }
  : { type: 'spring' as const, bounce: 0, duration: 0.4 }))
const pillHidden = computed(() => (reduceMotion.value ? { opacity: 0 } : { opacity: 0, y: -24, scale: 0.96 }))
const sent = ref<{ used: number; total: number } | null>(null)
let sentTimer: ReturnType<typeof setTimeout> | undefined
// The camera's native fullscreen element: only it is painted then, so
// the pill (and the consent sheet) teleport into it.
const fsLayer = useFullscreenElement()

function onUploaded(media: {
  id: string
  uploaded_at: string
  counts?: { photo_count: number; video_count: number; voice_count: number }
}) {
  if (media.counts) counts.value = media.counts
  sent.value = { used: usedFor(mode.value), total: limits.value[mode.value] }
  clearTimeout(sentTimer)
  sentTimer = setTimeout(() => { sent.value = null }, 1800)
}

// The server refused an upload for a reason that changes the screen.
// The component already shows the message; here we fix up state.
async function onRejected(code: string) {
  if (code === 'quota_exceeded') {
    // Trust the server over our counter, then pull the real numbers.
    const col = mode.value === 'photo' ? 'photo_count' : mode.value === 'video' ? 'video_count' : 'voice_count'
    counts.value = { ...counts.value, [col]: Math.max(counts.value[col], limits.value[mode.value]) }
  } else if (code === 'window_closed') {
    windowClosedByServer.value = true
  } else if (code === 'not_in_plan') {
    // The tier was lowered while the page was open: this mode is gone,
    // and with it the capture component showing why. Say it where it
    // stays on screen.
    toast.error(errorMessage(code, { variant: mode.value }))
  } else if (code === 'invalid_table') {
    // The admin cut the table count while the page was open. Load the
    // event as it is now, or decideStage() reads the old count once the
    // camera is gone and brings it straight back — refused again on
    // every shot, the message gone with the camera.
    await refreshBinding().catch(() => {})
    stage.value = 'no_table'
    return
  } else if (code === 'event_not_active') {
    await refresh()
    return
  } else if (code === 'guest_limit_reached') {
    // Let in on a binding that never reached the server, and the event
    // filled up since: nothing from this phone can be sent, so the frame
    // in review goes and the card says what to do instead.
    showGuestLimit()
    return
  } else if (code === 'consent_required') {
    // The texts changed while the page was open. Keep the camera (and
    // the frame waiting in review) and ask over it.
    consented.value = false
    acceptRules.value = false
    acceptPrivacy.value = false
    consentError.value = null
    consentSheet.value = true
    return
  }
  await refreshBinding().catch(() => {})
  decideStage()
}

// --- Consent asked over the camera ------------------------------------
// The capture components keep the refused frame in review; once the
// boxes are recorded, the one on screen sends it again.
const consentSheet = ref(false)
const captureRef = ref<{ send: () => Promise<void> } | null>(null)
// The sheet belongs to the camera: leaving it (frame discarded → the
// welcome form asks instead) closes it for good.
watch(stage, (s) => { if (s !== 'camera') consentSheet.value = false })

async function acceptAndSend() {
  if (welcomePending.value || !acceptRules.value || !acceptPrivacy.value || !deviceId.value || !tableParam.value) return
  welcomePending.value = true
  consentError.value = null
  try {
    await $fetch(`/api/guest/binding/${eventId.value}`, {
      method: 'POST',
      body: {
        device_id: deviceId.value,
        guest_name: guestName.value.trim() || binding.value?.guest_name || '',
        guest_table: tableParam.value,
        consent: consentFor('guest_upload'),
        locale: locale.value,
      },
    })
    consented.value = true
    consentSheet.value = false
    await captureRef.value?.send()
  } catch (e: any) {
    const code = e?.data?.data?.code ?? e?.data?.code
    if (code === 'guest_limit_reached') {
      consentSheet.value = false
      showGuestLimit()
      return
    }
    // The frame can't go any more; the page follows once it's dropped.
    if (code === 'window_closed') windowClosedByServer.value = true
    consentError.value = errorMessage(e, { fallback: 'guest.errors.upload_failed' })
  } finally {
    welcomePending.value = false
  }
}

// Focus moves into the sheet when it opens (keyboard / screen reader).
const sheetEl = ref<HTMLElement | null>(null)
watch(sheetEl, (el) => el?.focus({ preventScroll: true }))

const sheetSpring = computed(() => (reduceMotion.value
  ? { duration: 0.2 }
  : { type: 'spring' as const, bounce: 0, duration: 0.45 }))
const sheetHidden = computed(() => (reduceMotion.value ? { opacity: 0 } : { y: '100%' }))

// Build a small monogram from "Albert & Anna" → "A & A". Splits on
// `&`, `·`, `+`, " и " (Russian and), " va " (Uzbek and), " and "
// (English) so couple_names entered in any of the three languages
// gives a clean two-letter result.
const monogram = computed(() => {
  const raw = ev.value?.couple_names ?? ''
  const parts = raw
    .split(/\s*[&·+]\s*|\s+и\s+|\s+va\s+|\s+and\s+/i)
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0]![0]?.toUpperCase() ?? ''} & ${parts[1]![0]?.toUpperCase() ?? ''}`
  }
  return raw.slice(0, 2).toUpperCase()
})

// Month names are spelled out here instead of toLocaleDateString:
// Chromium ships no Uzbek month names ("2026 M09 28"), which also
// broke hydration against the server's "28-sentabr, 2026".
const UZ_MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr']
const RU_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
function dayMonth(month: number, day: number): string {
  return locale.value === 'uz' ? `${day}-${UZ_MONTHS[month - 1]}` : `${day} ${RU_MONTHS[month - 1]}`
}

const formattedDate = computed(() => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ev.value?.wedding_date ?? '')
  if (!m) return null
  const [, y, mo, d] = m
  return locale.value === 'uz'
    ? `${dayMonth(Number(mo), Number(d))}, ${y}`
    : `${dayMonth(Number(mo), Number(d))} ${y} г.`
})

/** "27-sentabr" + "18:00" for an instant, in Tashkent time. */
function tashkentLabel(iso: string | null | undefined): { date: string; time: string } | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  let p: Record<string, number>
  try {
    p = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Tashkent',
        hourCycle: 'h23',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).formatToParts(ms).map((x) => [x.type, Number(x.value)]),
    )
  } catch {
    const d = new Date(ms + 5 * 3_600_000) // UTC+5, no DST
    p = { month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes() }
  }
  const hh = String(p.hour).padStart(2, '0')
  const mm = String(p.minute).padStart(2, '0')
  return { date: dayMonth(p.month!, p.day!), time: `${hh}:${mm}` }
}
const opensLabel = computed(() => tashkentLabel(uploadWindow.value?.opens_at))

// "до 27 марта 2027" for the storage line of the consent notice.
const storedUntilLabel = computed(() => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ev.value?.archive_expires_at ?? '')
  if (!m) return null
  return `${dayMonth(Number(m[2]), Number(m[3]))} ${m[1]}`
})
const closesLabel = computed(() => tashkentLabel(uploadWindow.value?.closes_at))

// Cards overlap the cover photo when there is one; without a cover a
// negative margin pushed their top edge off the screen.
const hasCover = computed(() => !!ev.value?.branding?.cover_photo)

const wrongTableLink = computed(() =>
  binding.value ? { query: { ...route.query, t: String(binding.value.table_number) } } : null,
)

useSeoMeta({
  title: () => (ev.value?.couple_names ? `Memour · ${ev.value.couple_names}` : 'Memour'),
  description: () => t('guest.seo.description'),
})
</script>

<template>
  <div>
    <!-- "Sent" pill — above every stage, including CSS fullscreen; in
         native fullscreen it moves into the fullscreen element, the
         only thing painted then. -->
    <Teleport v-if="hydrated" :to="fsLayer ?? 'body'" :disabled="!fsLayer">
      <AnimatePresence>
        <motion.div
          v-if="sent"
          key="sent"
          class="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4"
          :style="{ top: 'max(env(safe-area-inset-top), 14px)' }"
          :initial="pillHidden"
          :animate="{ opacity: 1, y: 0, scale: 1 }"
          :exit="pillHidden"
          :transition="pillSpring"
          role="status"
        >
          <div class="flex items-center gap-2.5 rounded-full bg-white/95 py-1.5 pl-1.5 pr-4 shadow-[0_8px_28px_rgb(0_0_0_/_0.14)] ring-1 ring-black/5 backdrop-blur">
            <span class="grid h-7 w-7 place-items-center rounded-full bg-emerald-500 text-white">
              <Check class="h-4 w-4" :stroke-width="2.6" />
            </span>
            <span class="text-sm font-medium text-(--color-foreground)">
              {{ t('guest.camera.uploadedHeader', { count: `${sent.used}/${sent.total}` }) }}
            </span>
          </div>
        </motion.div>
      </AnimatePresence>
    </Teleport>

    <!-- Couldn't load the event -->
    <div v-if="fetchError" class="grid min-h-[100dvh] place-items-center p-6">
      <div class="surface-card max-w-md rounded-(--radius-xl) p-8 text-center">
        <template v-if="fetchErrorKind === 'temporary'">
          <h1 class="heading-display-md">{{ t('guest.state.errorTitle') }}</h1>
          <p class="mt-2 text-(--color-muted-foreground)">{{ t('guest.state.errorDesc') }}</p>
          <button
            type="button"
            :disabled="retrying"
            class="mt-6 inline-flex h-12 touch-manipulation items-center justify-center rounded-full bg-(--color-primary) px-6 text-sm font-medium text-(--color-primary-foreground) transition-transform duration-100 active:scale-[0.98] disabled:opacity-50"
            @click="retryFetch"
          >{{ retrying ? t('guest.state.loading') : t('guest.camera.tryAgain') }}</button>
        </template>
        <template v-else-if="fetchErrorKind === 'archived'">
          <h1 class="heading-display-md">{{ t('guest.state.archivedTitle') }}</h1>
          <p class="mt-2 text-(--color-muted-foreground)">{{ t('guest.state.archivedDesc') }}</p>
        </template>
        <template v-else>
          <h1 class="heading-display-md">{{ t('guest.state.notFoundTitle') }}</h1>
          <p class="mt-2 text-(--color-muted-foreground)">{{ t('guest.state.notFoundDesc') }}</p>
        </template>
      </div>
    </div>

    <div v-else-if="pending" class="grid min-h-[100dvh] place-items-center">
      <div class="text-(--color-muted-foreground)">{{ t('guest.state.loading') }}</div>
    </div>

    <!-- Draft -->
    <div v-else-if="isDraft" class="grid min-h-[100dvh] place-items-center p-6">
      <div class="surface-card max-w-md rounded-(--radius-xl) p-8 text-center">
        <p class="text-xs uppercase tracking-[0.3em] text-(--color-muted-foreground)">{{ ev?.couple_names }}</p>
        <h1 class="heading-display-md mt-3">{{ t('guest.state.draftTitle') }}</h1>
        <p class="mt-3 text-(--color-muted-foreground)">
          {{ t('guest.state.draftDesc') }}
        </p>
      </div>
    </div>

    <!-- ============================================================ -->
    <!--  ACTIVE EVENT — CAMERA STAGE: full-screen 3-zone layout       -->
    <!--                                                                -->
    <!--  Built around the thumb: identity + active-mode progress at    -->
    <!--  the top (only-read, never tap), the capture component fills   -->
    <!--  the middle, and every interactive element (mode switcher,    -->
    <!--  language switch) lives inside the bottom dock pinned to the   -->
    <!--  safe-area-aware bottom edge.                                  -->
    <!-- ============================================================ -->
    <div
      v-else-if="isActive && ev && stage === 'camera' && tableParam && deviceId"
      class="flex min-h-[100dvh] flex-col"
      :style="ev.branding?.accent_color
        ? { '--color-primary': ev.branding.accent_color } as Record<string, string>
        : undefined"
    >
      <!-- No header on the capture screen — every pixel goes to the
           viewport. Identity was set on the welcome screen, and each
           per-mode quota lives on its dock tab below. -->
      <div class="h-3 shrink-0" />

      <!-- MAIN — capture component fills remaining height. The
           component owns its idle illustration + capture button; this
           wrapper just gives it room and a max-width on tablets.
           `min-h-0` is the magic bit: without it, flex children with
           intrinsic content (e.g. a <video> tag) refuse to shrink
           below their content size and the whole page picks up a
           scrollbar on shorter phones. -->
      <main class="flex flex-1 flex-col min-h-0">
        <div class="mx-auto flex w-full max-w-md flex-1 flex-col min-h-0 px-4 pt-3 pb-2">
          <Transition
            enter-active-class="transition-opacity duration-150"
            leave-active-class="transition-opacity duration-150"
            enter-from-class="opacity-0"
            leave-to-class="opacity-0"
            mode="out-in"
          >
            <!-- This mode's quota is used up: say so, offer what's left.
                 The shutter never opens for shots we'd have to refuse. -->
            <div v-if="modeExhausted" :key="`done-${mode}`" class="flex flex-1 flex-col">
              <div class="flex flex-1 flex-col items-center justify-center text-center">
                <div class="grid h-20 w-20 place-items-center rounded-full border border-amber-200 bg-amber-50 text-amber-700">
                  <Check class="h-8 w-8" :stroke-width="1.6" />
                </div>
                <h3 class="mt-5 font-display text-2xl italic text-(--color-foreground)">
                  {{ t(`guest.exhausted.${mode}Title`, { total: limits[mode] }) }}
                </h3>
                <p class="mt-2 max-w-[16rem] text-sm leading-relaxed text-(--color-muted-foreground)">
                  {{ t('guest.exhausted.desc') }}
                </p>
              </div>
              <button
                v-for="m in modesLeft"
                :key="m"
                type="button"
                class="mb-2 inline-flex h-14 w-full touch-manipulation items-center justify-center rounded-full border border-(--color-border) bg-white text-base font-medium text-(--color-foreground) transition-transform duration-100 active:scale-[0.98]"
                @click="selectMode(m)"
              >{{ t(m === 'photo' ? 'guest.camera.openCamera' : m === 'video' ? 'guest.camera.recordVideo' : 'guest.camera.recordVoice') }}</button>
            </div>
            <GuestCamera
              v-else-if="mode === 'photo'"
              key="photo"
              ref="captureRef"
              :event-id="ev.id"
              :device-id="deviceId"
              :guest-name="guestName"
              :guest-table="tableParam"
              :geofence-enabled="geofenceEnabled"
              @uploaded="onUploaded"
              @rejected="onRejected"
              @busy="captureBusy = $event"
            />
            <GuestVideo
              v-else-if="mode === 'video'"
              key="video"
              ref="captureRef"
              :event-id="ev.id"
              :device-id="deviceId"
              :guest-name="guestName"
              :guest-table="tableParam"
              :geofence-enabled="geofenceEnabled"
              @uploaded="onUploaded"
              @rejected="onRejected"
              @busy="captureBusy = $event"
            />
            <GuestVoice
              v-else-if="mode === 'voice'"
              key="voice"
              ref="captureRef"
              :event-id="ev.id"
              :device-id="deviceId"
              :guest-name="guestName"
              :guest-table="tableParam"
              :geofence-enabled="geofenceEnabled"
              @uploaded="onUploaded"
              @rejected="onRejected"
              @busy="captureBusy = $event"
            />
          </Transition>
        </div>
      </main>

      <!-- DOCK — mode switcher (or the single photo counter on Basic)
           plus the language switch. Each tab carries its own N/M
           readout. Tabs lock while a frame is in review or uploading
           so switching can't throw it away. -->
      <footer
        class="sticky bottom-0 z-30 mx-auto w-full max-w-md shrink-0 border-t border-(--color-border)/40 bg-(--color-background)/95 px-4 pt-2.5 backdrop-blur"
        :style="{ paddingBottom: 'max(env(safe-area-inset-bottom), 10px)' }"
      >
        <div class="flex items-center gap-2">
          <div class="flex flex-1 items-center gap-1 rounded-full border border-(--color-border) bg-white p-1 shadow-[0_2px_8px_rgb(0_0_0_/_0.04)]">
            <template v-if="showModeTabs">
              <button
                v-for="m in availableModes"
                :key="m"
                type="button"
                :class="modeTabClass(m)"
                :aria-pressed="mode === m"
                :aria-label="t(m === 'photo' ? 'guest.camera.photoTab' : m === 'video' ? 'guest.camera.videoTab' : 'guest.camera.voiceTab')"
                :disabled="captureBusy && mode !== m"
                @click="selectMode(m)"
              >
                <span class="text-sm leading-none">{{ m === 'photo' ? '📸' : m === 'video' ? '🎥' : '🎤' }}</span>
                <span class="text-[10px] uppercase tracking-wider opacity-80">{{ usedFor(m) }}/{{ limits[m] }}</span>
              </button>
            </template>
            <div v-else class="flex flex-1 items-center justify-center gap-2 px-2 py-2 text-xs text-(--color-muted-foreground)">
              <span class="text-sm leading-none">📸</span>
              <span>{{ t('guest.camera.quotaPhotos', { used: counts.photo_count, total: limits.photo }) }}</span>
            </div>
          </div>
          <NuxtLink
            v-if="!captureBusy"
            :to="switchLocalePath(otherLocale)"
            :aria-label="otherLocaleLabel"
            class="grid h-11 w-11 shrink-0 touch-manipulation place-items-center rounded-full border border-(--color-border) bg-white text-[11px] font-medium uppercase tracking-wider text-(--color-muted-foreground) transition-colors hover:text-(--color-foreground)"
            @click="rememberLocale(otherLocale)"
          >{{ otherLocale }}</NuxtLink>
          <!-- Locked with the tabs: the other language remounts the page,
               and the frame in review or on its way would go with it. -->
          <span
            v-else
            role="link"
            aria-disabled="true"
            :aria-label="otherLocaleLabel"
            class="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-(--color-border) bg-white text-[11px] font-medium uppercase tracking-wider text-(--color-muted-foreground) opacity-40"
          >{{ otherLocale }}</span>
        </div>
      </footer>

      <!-- Consent asked over the camera: an upload was refused for want
           of it. The frame waits in review underneath and is sent once
           the boxes are recorded; "not now" or the backdrop keeps it.
           In native fullscreen it moves into the fullscreen element. -->
      <Teleport :to="fsLayer ?? 'body'" :disabled="!fsLayer">
        <AnimatePresence>
          <motion.div
            v-if="consentSheet"
            key="consent-backdrop"
            class="fixed inset-0 z-[70] bg-black/40"
            :initial="{ opacity: 0 }"
            :animate="{ opacity: 1 }"
            :exit="{ opacity: 0 }"
            :transition="{ duration: 0.2 }"
            aria-hidden="true"
            @click="consentSheet = false"
          />
        </AnimatePresence>
        <AnimatePresence>
          <motion.div
            v-if="consentSheet"
            key="consent-sheet"
            class="fixed inset-x-0 bottom-0 z-[71] mx-auto w-full max-w-md"
            :initial="sheetHidden"
            :animate="{ opacity: 1, y: 0 }"
            :exit="sheetHidden"
            :transition="sheetSpring"
          >
            <div
              ref="sheetEl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="consent-sheet-lead"
              tabindex="-1"
              class="max-h-[88dvh] overflow-y-auto rounded-t-2xl bg-(--color-background) px-5 pt-6 shadow-[0_-12px_40px_rgb(0_0_0_/_0.18)] focus:outline-none"
              :style="{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }"
              @keydown.esc="consentSheet = false"
            >
              <p id="consent-sheet-lead" class="text-center text-sm leading-relaxed text-(--color-foreground)">
                {{ t('guest.consent.sheetLead') }}
              </p>
              <GuestConsent
                v-model:rules="acceptRules"
                v-model:privacy="acceptPrivacy"
                :stored-until="storedUntilLabel"
                class="mt-5"
              />
              <p v-if="consentError" role="alert" class="mt-3 text-center text-xs text-red-700">{{ consentError }}</p>
              <button
                type="button"
                :disabled="!acceptRules || !acceptPrivacy || welcomePending"
                class="mt-4 inline-flex h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-md bg-(--color-primary) text-sm font-medium tracking-wide text-(--color-primary-foreground) shadow-(--shadow-soft) transition-[opacity,transform] duration-100 hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
                @click="acceptAndSend"
              >{{ t('guest.consent.acceptSend') }}</button>
              <button
                type="button"
                class="mt-1 inline-flex h-11 w-full touch-manipulation items-center justify-center text-sm text-(--color-muted-foreground) transition-colors hover:text-(--color-foreground)"
                @click="consentSheet = false"
              >{{ t('guest.consent.later') }}</button>
            </div>
          </motion.div>
        </AnimatePresence>
      </Teleport>
    </div>

    <!-- ============================================================ -->
    <!--  ACTIVE EVENT — non-camera stages (welcome, errors, quota)    -->
    <!--                                                                -->
    <!--  Card-centric, scrolling layout. Cover photo at top, content   -->
    <!--  card in the middle, language switch as a quiet text link at   -->
    <!--  the bottom of the column so it never overlaps content.       -->
    <!-- ============================================================ -->
    <div
      v-else-if="isActive && ev"
      class="relative mx-auto max-w-md px-4 pb-12 pt-4 sm:pt-10"
      :style="ev.branding?.accent_color
        ? { '--color-primary': ev.branding.accent_color } as Record<string, string>
        : undefined"
    >
      <!-- Cover hero — present on welcome / locked-state screens -->
      <div
        v-if="hasCover"
        class="relative -mx-4 aspect-[4/3] overflow-hidden sm:rounded-(--radius-xl)"
      >
        <img :src="ev.branding!.cover_photo!" alt="" class="h-full w-full object-cover">
        <div class="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-(--color-background) via-(--color-background)/85 to-transparent" />
      </div>

      <Transition
        enter-active-class="transition duration-500"
        enter-from-class="opacity-0 translate-y-3"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition duration-200"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
        mode="out-in"
      >
        <!-- ============== CHECKING THIS PHONE (full event) ============== -->
        <div
          v-if="stage === 'checking'"
          key="checking"
          :class="['text-center', hasCover ? '-mt-10' : 'mt-8']"
          role="status"
          aria-busy="true"
        >
          <div class="surface-card rounded-(--radius-xl) p-8">
            <p class="text-xs uppercase tracking-[0.3em] text-(--color-muted-foreground)">{{ ev.couple_names }}</p>
            <Skeleton class="mx-auto mt-4 h-7 w-2/3" />
            <Skeleton class="mx-auto mt-4 h-4 w-5/6" />
            <Skeleton class="mx-auto mt-2 h-4 w-1/2" />
            <span class="sr-only">{{ t('guest.state.loading') }}</span>
          </div>
        </div>

        <!-- ============== WELCOME ============== -->
        <div v-else-if="stage === 'welcome'" key="welcome">
          <!-- Monogram disc + names -->
          <motion.div
            :initial="hydrated ? { opacity: 0, y: 16 } : false"
            :animate="{ opacity: 1, y: 0 }"
            :transition="{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }"
            :class="['relative text-center', hasCover ? '-mt-12' : 'mt-6']"
          >
            <div class="mx-auto inline-flex h-24 w-24 items-center justify-center rounded-full border border-(--color-border) bg-(--color-background) shadow-[0_8px_28px_rgb(0_0_0_/_0.08)]">
              <span class="font-display text-2xl italic text-gradient-gold">{{ monogram }}</span>
            </div>
            <p class="mt-5 text-[10px] uppercase tracking-[0.42em] text-(--color-muted-foreground)">
              {{ t('guest.welcome.eyebrow') }}
            </p>
            <h1 class="mt-2 font-display text-[2rem] leading-tight italic">
              <span class="text-gradient-gold">{{ ev.couple_names }}</span>
            </h1>
            <p v-if="formattedDate" class="mt-1 text-sm italic text-(--color-muted-foreground)">
              {{ formattedDate }}<span v-if="ev.venue_name"> · {{ ev.venue_name }}</span>
            </p>
            <div class="mt-5 flex items-center justify-center gap-3 text-(--color-muted-foreground)">
              <span class="h-px w-12 bg-gradient-to-r from-transparent via-(--color-border) to-(--color-border)" />
              <span class="text-amber-700">✦</span>
              <span class="h-px w-12 bg-gradient-to-l from-transparent via-(--color-border) to-(--color-border)" />
            </div>
          </motion.div>

          <!-- BIG GOLD TABLE BADGE -->
          <motion.div
            v-if="tableParam"
            :initial="hydrated ? { opacity: 0, scale: 0.92 } : false"
            :animate="{ opacity: 1, scale: 1 }"
            :transition="{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }"
            class="mt-8 flex justify-center"
          >
            <div class="relative inline-flex flex-col items-center rounded-full border border-amber-200/60 bg-gradient-to-br from-amber-50 via-[#fdf6e3] to-amber-100 px-12 py-5 shadow-[0_10px_36px_rgb(180_130_60_/_0.18)]">
              <span class="text-[10px] uppercase tracking-[0.4em] text-amber-700/80">{{ t('guest.welcome.tableEyebrow') }}</span>
              <span class="font-display text-5xl italic leading-none text-amber-900">№ {{ tableParam }}</span>
            </div>
          </motion.div>

          <!-- Greeting -->
          <p class="mx-auto mt-6 max-w-sm text-center text-sm italic text-(--color-muted-foreground)">
            {{ ev.branding?.greeting_text || t('guest.welcome.greetingDefault') }}
          </p>

          <!-- Name input card -->
          <motion.div
            :initial="hydrated ? { opacity: 0, y: 12 } : false"
            :animate="{ opacity: 1, y: 0 }"
            :transition="{ duration: 0.6, delay: 0.3, ease: [0.16, 1, 0.3, 1] }"
            class="mt-8 rounded-(--radius-xl) border border-(--color-border)/60 bg-white/90 p-6 backdrop-blur"
          >
            <label class="block text-center text-[10px] uppercase tracking-[0.3em] text-(--color-muted-foreground)">
              {{ t('guest.welcome.nameQuestion') }}
            </label>
            <input
              v-model="guestName"
              type="text"
              maxlength="80"
              :placeholder="t('guest.welcome.namePlaceholder')"
              autofocus
              class="mt-3 h-12 w-full rounded-md border border-(--color-border)/70 bg-(--color-background) px-4 text-center text-base placeholder:text-(--color-muted-foreground)/60 focus-visible:border-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200/60"
              @keydown.enter="startCapture"
            >

            <!-- Before the first upload: what happens to the files, and
                 the two boxes the server records (never pre-ticked). -->
            <GuestConsent
              v-if="!consented"
              v-model:rules="acceptRules"
              v-model:privacy="acceptPrivacy"
              :stored-until="storedUntilLabel"
              class="mt-6"
            />
            <p v-if="consentError" role="alert" class="mt-3 text-center text-xs text-red-700">{{ consentError }}</p>

            <button
              type="button"
              :disabled="!guestName.trim() || !consentReady || welcomePending"
              class="mt-4 inline-flex h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-md bg-(--color-primary) text-sm font-medium tracking-wide text-(--color-primary-foreground) shadow-(--shadow-soft) transition-[opacity,transform] duration-100 hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
              @click="startCapture"
            >
              {{ welcomePending ? t('guest.camera.uploadingShort') : t('guest.welcome.openCamera') }}
            </button>
            <p class="mt-3 text-center text-[11px] leading-relaxed text-(--color-muted-foreground)">
              {{ t('guest.welcome.nameHint') }}
            </p>
          </motion.div>
        </div>

        <!-- ============== UPLOAD WINDOW NOT OPEN YET ============== -->
        <div v-else-if="stage === 'window_before'" key="window_before" :class="['text-center', hasCover ? '-mt-10' : 'mt-8']">
          <div class="surface-card rounded-(--radius-xl) p-8">
            <p class="text-xs uppercase tracking-[0.3em] text-(--color-muted-foreground)">{{ ev.couple_names }}</p>
            <h2 class="mt-3 font-display text-2xl italic">{{ t('guest.window.beforeTitle') }}</h2>
            <p class="mt-3 text-sm leading-relaxed text-(--color-muted-foreground)">
              {{ opensLabel
                ? t('guest.window.beforeDesc', { date: opensLabel.date, time: opensLabel.time })
                : t('guest.errors.window_not_open') }}
            </p>
          </div>
        </div>

        <!-- ============== UPLOAD WINDOW CLOSED ============== -->
        <div v-else-if="stage === 'window_after'" key="window_after" :class="['text-center', hasCover ? '-mt-10' : 'mt-8']">
          <div class="surface-card rounded-(--radius-xl) p-8">
            <p class="text-xs uppercase tracking-[0.3em] text-(--color-muted-foreground)">{{ ev.couple_names }}</p>
            <h2 class="mt-3 font-display text-2xl italic">{{ t('guest.window.afterTitle') }}</h2>
            <p class="mt-3 text-sm leading-relaxed text-(--color-muted-foreground)">
              {{ closesLabel
                ? t('guest.window.afterDesc', { date: closesLabel.date, time: closesLabel.time })
                : t('guest.errors.window_closed') }}
            </p>
          </div>
        </div>

        <!-- ============== NO TABLE IN URL ============== -->
        <div v-else-if="stage === 'no_table'" key="no_table" :class="['text-center', hasCover ? '-mt-10' : 'mt-8']">
          <div class="surface-card rounded-(--radius-xl) p-8">
            <div class="mx-auto grid h-14 w-14 place-items-center rounded-full bg-amber-50">
              <span class="text-2xl">⌫</span>
            </div>
            <h2 class="mt-4 font-display text-2xl italic">{{ t('guest.noTable.title') }}</h2>
            <p class="mt-2 text-sm text-(--color-muted-foreground)">
              {{ t('guest.noTable.desc') }}
            </p>
          </div>
        </div>

        <!-- ============== DEVICE LOCKED TO ANOTHER TABLE ============== -->
        <div v-else-if="stage === 'wrong_table'" key="wrong_table" :class="['text-center', hasCover ? '-mt-10' : 'mt-8']">
          <div class="surface-card rounded-(--radius-xl) p-8">
            <div class="mx-auto grid h-14 w-14 place-items-center rounded-full border border-amber-200 bg-amber-50 text-amber-700">
              <span class="text-xl">⊘</span>
            </div>
            <h2 class="mt-4 font-display text-2xl italic">{{ t('guest.wrongTable.title') }}</h2>
            <p v-if="binding" class="mt-3 text-sm leading-relaxed text-(--color-muted-foreground)">
              {{ t('guest.wrongTable.descBefore') }}
              <strong class="font-medium text-(--color-foreground)">{{ t('guest.wrongTable.tableLabel', { n: binding.table_number }) }}</strong>.
              {{ t('guest.wrongTable.descAfter') }}
            </p>
            <p v-else class="mt-3 text-sm leading-relaxed text-(--color-muted-foreground)">
              {{ t('guest.wrongTable.descUnknown') }}
            </p>
            <p v-if="tableParam" class="mt-3 text-xs italic text-(--color-muted-foreground)">
              {{ t('guest.wrongTable.currentScan', { table: tableParam }) }}
            </p>
            <NuxtLink
              v-if="wrongTableLink && binding"
              :to="wrongTableLink"
              replace
              class="mt-6 inline-flex h-12 w-full touch-manipulation items-center justify-center rounded-full bg-(--color-primary) px-5 text-sm font-medium text-(--color-primary-foreground) transition-transform duration-100 active:scale-[0.98]"
            >{{ t('guest.wrongTable.goToTable', { n: binding.table_number }) }}</NuxtLink>
          </div>
        </div>

        <!-- ============== EVERY GUEST PLACE TAKEN ============== -->
        <div v-else-if="stage === 'guest_limit'" key="guest_limit" :class="['text-center', hasCover ? '-mt-10' : 'mt-8']">
          <div class="surface-card rounded-(--radius-xl) p-8">
            <div class="mx-auto grid h-14 w-14 place-items-center rounded-full border border-amber-200 bg-amber-50 text-amber-700">
              <Users class="h-6 w-6" :stroke-width="1.6" aria-hidden="true" />
            </div>
            <p class="mt-4 text-xs uppercase tracking-[0.3em] text-(--color-muted-foreground)">{{ ev.couple_names }}</p>
            <h2 class="mt-2 font-display text-2xl italic">{{ t('guest.guestLimit.title') }}</h2>
            <p class="mt-3 text-sm leading-relaxed text-(--color-muted-foreground)">
              {{ t('guest.guestLimit.desc') }}
            </p>
            <p class="mt-5 rounded-md border border-(--color-border)/60 bg-white/70 px-4 py-3 text-sm leading-relaxed text-(--color-foreground)">
              {{ t('guest.guestLimit.hint') }}
            </p>
          </div>
        </div>

        <!-- ============== QUOTA FULL ============== -->
        <div v-else-if="stage === 'quota_full'" key="quota_full" :class="['text-center', hasCover ? '-mt-10' : 'mt-8']">
          <div class="surface-card rounded-(--radius-xl) p-8">
            <div class="mx-auto grid h-14 w-14 place-items-center rounded-full border border-amber-200 bg-amber-50 text-amber-700">
              <span class="text-xl">✓</span>
            </div>
            <h2 class="mt-4 font-display text-2xl italic">{{ t('guest.quotaFull.title') }}</h2>
            <p class="mt-3 text-sm leading-relaxed text-(--color-muted-foreground)">
              {{ t('guest.quotaFull.desc') }}
            </p>
            <div :class="['mt-5 grid gap-3 text-center', availableModes.length === 3 ? 'grid-cols-3' : availableModes.length === 2 ? 'grid-cols-2' : 'grid-cols-1']">
              <div v-for="m in availableModes" :key="m" class="rounded-md border border-(--color-border)/60 bg-white/70 px-2 py-3">
                <p class="text-[9px] uppercase tracking-widest text-(--color-muted-foreground)">{{ t(`guest.quotaFull.${m}`) }}</p>
                <p class="mt-1 font-display text-lg">{{ usedFor(m) }}<span class="text-(--color-muted-foreground)">/{{ limits[m] }}</span></p>
              </div>
            </div>
          </div>
        </div>

      </Transition>

      <!-- Language switch — quiet text link at the foot of every
           non-camera state. Doesn't compete with content; one tap
           swaps the locale prefix on the current path so the ?t=
           query (the table the guest scanned) survives. -->
      <div class="mt-10 flex justify-center">
        <NuxtLink
          :to="switchLocalePath(otherLocale)"
          class="inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-xs text-(--color-muted-foreground) transition-colors hover:text-(--color-foreground)"
          :aria-label="otherLocaleLabel"
          @click="rememberLocale(otherLocale)"
        >
          <svg viewBox="0 0 24 24" class="h-3 w-3 opacity-60" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 7h13l-3-3" />
            <path d="M21 17H8l3 3" />
          </svg>
          {{ otherLocaleLabel }}
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
