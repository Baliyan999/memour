/**
 * Identify an uploaded file by its first bytes instead of trusting the
 * Content-Type the client wrote into the multipart part.
 *
 * Only the containers the guest UI can actually produce are
 * recognised: canvas/compressor JPEGs (plus PNG/WebP from the system
 * camera fallback), MediaRecorder WebM/MP4 for video, and WebM/MP4/
 * MP3/Ogg for voice. Everything else — HTML, zips, TIFF/GIF/SVG that
 * libvips would happily try to decode — is rejected before sharp or
 * Storage ever see it.
 */
export type MediaContainer = 'jpeg' | 'png' | 'webp' | 'webm' | 'mp4' | 'mp3' | 'ogg'

export function sniffContainer(buf: Buffer): MediaContainer | null {
  if (buf.length < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  // EBML header — WebM / Matroska.
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm'
  // ISO BMFF (MP4 / M4A) — `ftyp` box right after the 4-byte size.
  if (buf.toString('latin1', 4, 8) === 'ftyp') return 'mp4'
  if (buf.toString('latin1', 0, 4) === 'OggS') return 'ogg'
  // MP3 — ID3 tag or a bare MPEG audio frame sync.
  if (buf.toString('latin1', 0, 3) === 'ID3') return 'mp3'
  if (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0) return 'mp3'
  return null
}
