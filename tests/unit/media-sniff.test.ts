import { describe, expect, it } from 'vitest'
import { sniffContainer } from '../../server/utils/media-sniff'

/** First bytes + zero padding up to `len` (the sniffer needs at least 12). */
function bytes(head: number[] | string, len = 32): Buffer {
  const h = typeof head === 'string' ? Buffer.from(head, 'latin1') : Buffer.from(head)
  return Buffer.concat([h, Buffer.alloc(Math.max(0, len - h.length))])
}

describe('sniffContainer', () => {
  it('recognises what the guest UI produces', () => {
    expect(sniffContainer(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg')
    expect(sniffContainer(bytes([0xff, 0xd8, 0xff, 0xe1]))).toBe('jpeg') // EXIF
    expect(sniffContainer(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png')
    expect(sniffContainer(bytes('RIFF\x24\x00\x00\x00WEBPVP8 '))).toBe('webp')
    expect(sniffContainer(bytes([0x1a, 0x45, 0xdf, 0xa3]))).toBe('webm')
    expect(sniffContainer(bytes('\x00\x00\x00\x18ftypmp42'))).toBe('mp4')
    expect(sniffContainer(bytes('\x00\x00\x00\x1cftypM4A '))).toBe('mp4')
    expect(sniffContainer(bytes('OggS\x00\x02'))).toBe('ogg')
    expect(sniffContainer(bytes('ID3\x04\x00'))).toBe('mp3')
    expect(sniffContainer(bytes([0xff, 0xfb, 0x90, 0x64]))).toBe('mp3') // bare MPEG frame sync
  })

  it('tells a JPEG from an MPEG frame although both start with 0xFF', () => {
    expect(sniffContainer(bytes([0xff, 0xd8, 0xff]))).toBe('jpeg')
    expect(sniffContainer(bytes([0xff, 0xf3]))).toBe('mp3')
    expect(sniffContainer(bytes([0xff, 0xd8, 0x00]))).toBeNull() // 0xD8 has no frame-sync bits
  })

  it('refuses anything shorter than 12 bytes, even with a valid signature', () => {
    expect(sniffContainer(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull()
    expect(sniffContainer(Buffer.alloc(0))).toBeNull()
  })

  it('rejects what sharp would happily decode but the UI never sends', () => {
    expect(sniffContainer(bytes('GIF89a'))).toBeNull()
    expect(sniffContainer(bytes([0x49, 0x49, 0x2a, 0x00]))).toBeNull() // TIFF LE
    expect(sniffContainer(bytes([0x4d, 0x4d, 0x00, 0x2a]))).toBeNull() // TIFF BE
    expect(sniffContainer(bytes('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull()
    expect(sniffContainer(bytes('BM6\x00\x00\x00'))).toBeNull() // BMP
  })

  it('rejects documents and archives whatever the declared type', () => {
    expect(sniffContainer(bytes('<!DOCTYPE html><html>'))).toBeNull()
    expect(sniffContainer(bytes('PK\x03\x04'))).toBeNull() // zip
    expect(sniffContainer(bytes('%PDF-1.7'))).toBeNull()
    expect(sniffContainer(bytes('RIFF\x24\x00\x00\x00WAVEfmt '))).toBeNull() // RIFF, but not WebP
  })

  it('classes HEIC (ISO BMFF) as mp4, which the photo route does not accept', () => {
    // An iPhone HEIC is an ftyp container: it can only ever pass as video/voice
    // mp4, never as a photo (upload.post.ts maps photo to jpeg/png/webp only).
    expect(sniffContainer(bytes('\x00\x00\x00\x18ftypheic'))).toBe('mp4')
  })
})
