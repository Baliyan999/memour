/**
 * Shared bits of the three guest capture components (photo / video /
 * voice): why the camera or mic can't start, the guest's location for
 * the soft geofence, and code → localized message.
 */

export type GuestKind = 'photo' | 'video' | 'voice'

/**
 * Link opened inside Instagram / Facebook / TikTok / an Android
 * WebView. Those often block the camera or MediaRecorder even when
 * the API exists; the fix for the guest is "open in Safari/Chrome".
 */
export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  return /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Snapchat|TikTok|musical_ly|; wv\)/i.test(navigator.userAgent)
}

/**
 * A reason this page can't capture at all, known before asking for
 * permission: plain http (no secure context → no getUserMedia), or a
 * browser/webview without the API.
 */
export function captureSupportIssue(): string | null {
  if (typeof window === 'undefined') return null
  if (!window.isSecureContext) return 'insecure_context'
  if (!navigator.mediaDevices?.getUserMedia) return 'camera_unsupported'
  return null
}

/** Map a getUserMedia rejection (DOMException name) to our code. */
export function mediaErrorCode(e: unknown, device: 'camera' | 'mic'): string {
  const name = (e as { name?: string } | null)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return 'permission_denied'
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return `${device}_not_found`
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return `${device}_busy`
  }
  return `${device}_unavailable`
}

/** MediaRecorder with the first mime this browser can actually record. */
export function createRecorder(stream: MediaStream, candidates: string[], options: MediaRecorderOptions = {}): MediaRecorder | null {
  if (typeof MediaRecorder === 'undefined') return null
  const mimeType = candidates.find((m) => {
    try { return MediaRecorder.isTypeSupported(m) } catch { return false }
  })
  try {
    return new MediaRecorder(stream, mimeType ? { ...options, mimeType } : options)
  } catch {
    try {
      // Some WebKit builds reject every explicit option; let it pick.
      return new MediaRecorder(stream)
    } catch {
      return null
    }
  }
}

/** Resolves once the stream paints real frames (videoWidth > 0). */
export function waitForFirstFrame(video: HTMLVideoElement, timeoutMs = 8000): Promise<boolean> {
  if (video.videoWidth > 0) return Promise.resolve(true)
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer)
      video.removeEventListener('loadeddata', check)
      video.removeEventListener('playing', check)
      video.removeEventListener('resize', check)
      resolve(ok)
    }
    const check = () => { if (video.videoWidth > 0) done(true) }
    const timer = setTimeout(() => done(video.videoWidth > 0), timeoutMs)
    video.addEventListener('loadeddata', check)
    video.addEventListener('playing', check)
    video.addEventListener('resize', check)
  })
}

// --- Location for the soft geofence ---------------------------------
// Shared across the three components so switching modes doesn't ask
// again. The fix is advisory (the server only refuses guests who are
// clearly far away), so a slow or denied fix never holds up a send.
interface GuestCoords { latitude: number; longitude: number; accuracy: number; at: number }
const FRESH_MS = 2 * 60_000
let cached: GuestCoords | null = null
let inflight: Promise<GuestCoords | null> | null = null

function requestFix(): Promise<GuestCoords | null> {
  if (inflight) return inflight
  inflight = new Promise<GuestCoords | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        cached = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          at: Date.now(),
        }
        resolve(cached)
      },
      () => resolve(null),
      // High accuracy indoors: Wi-Fi-only fixes are often hundreds of
      // metres off, which used to reject guests standing in the hall.
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: FRESH_MS },
    )
  }).finally(() => { inflight = null })
  return inflight
}

export function useGuestLocation(enabled: () => boolean) {
  const available = () => enabled() && typeof navigator !== 'undefined' && 'geolocation' in navigator

  /** Start a fix early (on the first shutter press) so it's ready by send. */
  function prime() {
    if (!available()) return
    if (cached && Date.now() - cached.at < FRESH_MS) return
    void requestFix()
  }

  /** Best fix we can get in ~3 s; null means "send without location". */
  async function get(): Promise<GuestCoords | null> {
    if (!available()) return null
    if (cached && Date.now() - cached.at < FRESH_MS) return cached
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000))
    return (await Promise.race([requestFix(), timeout])) ?? cached
  }

  return { prime, get }
}

// --- Messages --------------------------------------------------------

/**
 * code → text in the page's language (useErrorMessage with the guest
 * scope and this component's kind as the variant):
 *   guest.errors.<code>_<kind>  (e.g. file_too_large_video)
 *   guest.errors.<code>
 *   errors.<code>_<kind>, errors.<code>
 *   guest.camera.genericError
 * Never shows a raw code, e.message or an HTTP status text.
 */
export function useGuestErrorMessage(kind: GuestKind) {
  const errorMessage = useErrorMessage('guest')
  return (code: string | null | undefined, params: Record<string, unknown> = {}): string | null => {
    if (!code || code === 'aborted') return null
    return errorMessage(code, { variant: kind, params, fallback: 'guest.camera.genericError' })
  }
}
