import type { H3Event } from 'h3'

/**
 * Bounded multipart/form-data reader for the anonymous guest upload.
 *
 * Why not h3's readMultipartFormData: it buffers the whole body with
 * no size limit BEFORE the handler can look at anything, and its
 * parser copies the body byte by byte into a JS array — a 25 MB video
 * cost ~1.3 GB of RSS and one large junk POST took the process down.
 *
 * Here:
 *   1. Content-Length is required and checked against `maxBytes`
 *      before a single body byte is read (411 / 413).
 *   2. Bodies held in memory across all concurrent requests share a
 *      budget; past it we answer 503 + Retry-After instead of letting
 *      a burst of videos OOM the box.
 *   3. The body is split on the boundary with Buffer.indexOf — part
 *      data are zero-copy views into one Buffer.
 *   4. Part count and text-field size are capped.
 */
export interface MultipartPart {
  name: string
  filename?: string
  type?: string
  data: Buffer
}

export interface MultipartLimits {
  maxBytes: number
  maxParts: number
  maxFieldBytes: number
}

// Upper bound on request bodies held in memory at once, across all
// concurrent uploads: ~8 worst-case videos, or several hundred photos.
const INFLIGHT_BUDGET_BYTES = 256 * 1024 * 1024
let inflightBytes = 0

function reject(statusCode: number, code: string): never {
  throw createError({ statusCode, statusMessage: code, data: { code } })
}

function boundaryOf(contentType: string): string | null {
  if (!/^multipart\/form-data\b/i.test(contentType)) return null
  const m = /;\s*boundary=(?:"([^"]+)"|([^\s;]+))/i.exec(contentType)
  const b = m?.[1] ?? m?.[2]
  // RFC 2046: 1–70 characters.
  return b && b.length <= 70 ? b : null
}

async function readBodyCapped(event: H3Event, declared: number): Promise<Buffer> {
  const req = event.node.req
  // One allocation of exactly the announced size; chunks are copied in
  // and dropped, so the body never exists twice in memory.
  const body = Buffer.allocUnsafe(declared)
  let total = 0
  try {
    for await (const chunk of req) {
      const buf = chunk as Buffer
      // Node already stops at Content-Length; this is belt and braces.
      if (total + buf.length > declared) {
        req.destroy()
        reject(413, 'file_too_large')
      }
      buf.copy(body, total)
      total += buf.length
    }
  } catch (e: any) {
    if (e?.data?.code) throw e
    // The client went away mid-body (flaky venue Wi-Fi). Nobody is
    // listening for the answer; just don't log it as a server bug.
    reject(400, 'invalid_multipart')
  }
  if (total !== declared) reject(400, 'invalid_multipart')
  return body
}

function parseHeaders(raw: string): { name?: string; filename?: string; type?: string } {
  const out: { name?: string; filename?: string; type?: string } = {}
  for (const line of raw.split('\r\n')) {
    const i = line.indexOf(':')
    if (i < 0) continue
    const key = line.slice(0, i).trim().toLowerCase()
    const value = line.slice(i + 1).trim()
    if (key === 'content-disposition') {
      out.name = /(?:^|;)\s*name="([^"]*)"/i.exec(value)?.[1]
      out.filename = /(?:^|;)\s*filename="([^"]*)"/i.exec(value)?.[1]
    } else if (key === 'content-type') {
      out.type = value
    }
  }
  return out
}

function splitParts(body: Buffer, boundary: string, limits: MultipartLimits): MultipartPart[] {
  const delimiter = Buffer.from(`--${boundary}`)
  const nextDelimiter = Buffer.from(`\r\n--${boundary}`)
  const parts: MultipartPart[] = []

  let pos = body.indexOf(delimiter)
  if (pos < 0) reject(400, 'invalid_multipart')
  pos += delimiter.length

  for (;;) {
    // "--" right after a delimiter closes the body.
    if (body[pos] === 0x2d && body[pos + 1] === 0x2d) break
    if (body[pos] !== 0x0d || body[pos + 1] !== 0x0a) reject(400, 'invalid_multipart')
    pos += 2

    const headerEnd = body.indexOf('\r\n\r\n', pos, 'latin1')
    if (headerEnd < 0 || headerEnd - pos > 4096) reject(400, 'invalid_multipart')
    const headers = parseHeaders(body.toString('utf8', pos, headerEnd))
    const dataStart = headerEnd + 4

    const dataEnd = body.indexOf(nextDelimiter, dataStart)
    if (dataEnd < 0) reject(400, 'invalid_multipart')

    if (parts.length >= limits.maxParts) reject(400, 'invalid_multipart')
    if (headers.name) {
      const data = body.subarray(dataStart, dataEnd)
      if (headers.filename === undefined && data.length > limits.maxFieldBytes) {
        reject(422, 'invalid_input')
      }
      parts.push({ name: headers.name, filename: headers.filename, type: headers.type, data })
    }
    pos = dataEnd + nextDelimiter.length
  }
  return parts
}

export async function readMultipartLimited(event: H3Event, limits: MultipartLimits): Promise<MultipartPart[]> {
  const boundary = boundaryOf(getRequestHeader(event, 'content-type') ?? '')
  if (!boundary) reject(400, 'invalid_multipart')

  const rawLength = getRequestHeader(event, 'content-length')
  if (!rawLength || !/^\d+$/.test(rawLength)) reject(411, 'length_required')
  const declared = Number(rawLength)
  if (declared > limits.maxBytes) reject(413, 'file_too_large')

  if (inflightBytes + declared > INFLIGHT_BUDGET_BYTES) {
    setResponseHeader(event, 'Retry-After', 5)
    reject(503, 'server_busy')
  }
  // Released when the response is done — the parsed parts are views
  // into this body and live until the handler returns.
  inflightBytes += declared
  let released = false
  const release = () => {
    if (released) return
    released = true
    inflightBytes -= declared
  }
  event.node.res.once('close', release)

  try {
    const body = await readBodyCapped(event, declared)
    return splitParts(body, boundary!, limits)
  } catch (e) {
    release()
    throw e
  }
}
