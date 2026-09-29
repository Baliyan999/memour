import { createHash } from 'node:crypto'
import {
  legalDocsLive,
  legalPreview,
  type LegalConfig,
  type LegalDoc,
} from '#shared/legal'

/**
 * Full legal documents (server/assets/legal/{uz,ru}/{doc}.md, written by
 * scripts/legal-publish.mjs) rendered for the /privacy, /terms and
 * /offer pages.
 *
 * The files carry {{entity.*}} tokens for the operator's details; they
 * are filled here from runtime config (public.legal), so the owner
 * sets NUXT_PUBLIC_LEGAL_ENTITY_* on the server instead of editing the
 * text. `textSha256` is the hash of exactly that filled-in markdown —
 * what a consent record points to.
 *
 * The markdown is the small subset the drafts use: headings, rules,
 * paragraphs (a line break stays a line break), lists, quotes, tables,
 * bold / italic, links. Everything is HTML-escaped before any markup is
 * added, so the text can't inject tags.
 */

export type Locale = 'uz' | 'ru'

export interface LegalTocItem { id: string; text: string }
export interface RenderedLegalDoc {
  title: string
  subtitle: string
  toc: LegalTocItem[]
  html: string
  textSha256: string
}

// Anchors other pages link to; the interim pages use the same ids.
const ANCHORS: Record<LegalDoc, Record<string, string>> = {
  privacy: { 15: 'cookies' },
  terms: { 7: 'guest-rules' },
  offer: { 16: 'refund' },
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** "1. ОБЩИЕ ПОЛОЖЕНИЯ" → "1. Общие положения"; mixed-case text is left alone. */
function sentenceCase(text: string): string {
  const letters = text.replace(/[^\p{L}]/gu, '')
  if (letters.length < 4 || letters !== letters.toUpperCase()) return text
  return text
    .toLowerCase()
    .replace(/(^|[.!?]\s+|^\S*\d\S*\s+)(\p{L})/gu, (_, pre, ch) => pre + ch.toUpperCase())
    .replace(/memour/gi, 'Memour')
}

function inline(src: string, preview: boolean): string {
  let s = escapeHtml(src)
  // Links: [text](url) — only site paths, http(s) and mailto.
  s = s.replace(/\[([^\]\n]+)\]\(((?:\/|https?:\/\/|mailto:)[^)\s]*)\)/g, (_, text, href) =>
    `<a href="${href}"${href.startsWith('http') ? ' rel="noopener"' : ''}>${text}</a>`)
  // Bare URLs and e-mail addresses (not inside a tag we just made).
  s = s.replace(/(^|[\s(«;])((?:https?:\/\/)[^\s<)»;,]+[^\s<)»;,.])/g, (_, pre, url) => `${pre}<a href="${url}" rel="noopener">${url}</a>`)
  s = s.replace(/(^|[\s(«;])([\w.+-]+@[\w-]+\.[\w.-]*\w)/g, (_, pre, mail) => `${pre}<a href="mailto:${mail}">${mail}</a>`)
  s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[\s(«])\*([^*\s][^*]*?)\*(?=[\s).,;:»]|$)/g, '$1<em>$2</em>')
  // Open placeholders — only ever visible in the owner's preview.
  if (preview) s = s.replace(/\[[^\]\n]*\](?!\()/g, (m) => `<mark>${m}</mark>`)
  return s
}

/** Id for a heading: numbered sections and appendices get stable ids in both languages. */
function headingId(doc: LegalDoc, text: string, used: Set<string>): string {
  let id: string
  let m: RegExpExecArray | null
  if (/^(Коротко о главном|Qisqacha)/i.test(text)) id = 'summary'
  else if ((m = /^(\d+(?:\.\d+)*)\.?\s/.exec(text))) {
    const num = m[1]!
    id = ANCHORS[doc][num] ?? `section-${num.replace(/\./g, '-')}`
  } else if ((m = /^(?:Приложение|ПРИЛОЖЕНИЕ)\s+(\S+?)\.?\s/.exec(text)) || (m = /^(\S+?)-(?:ilova|ILOVA)\b/.exec(text))) {
    id = `appendix-${m[1]!.toLowerCase()}`
  } else id = 'part'
  let unique = id
  for (let n = 2; used.has(unique); n++) unique = `${id}-${n}`
  used.add(unique)
  return unique
}

function renderBlocks(lines: string[], doc: LegalDoc, preview: boolean, toc: LegalTocItem[] | null, used: Set<string>): string {
  const out: string[] = []
  let i = 0
  const isTable = (l: string) => /^\s*\|/.test(l)
  const isQuote = (l: string) => /^\s*>/.test(l)
  const isUl = (l: string) => /^\s*[-*•]\s+/.test(l)
  const isOl = (l: string) => /^\s*\d+\.\s+/.test(l)
  const isHeading = (l: string) => /^#{1,6}\s/.test(l)
  const isRule = (l: string) => /^---\s*$/.test(l)

  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) { i++; continue }

    if (isRule(line)) { out.push('<hr>'); i++; continue }

    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      const raw = h[2]!.trim()
      const id = headingId(doc, raw, used)
      // The summary opens every document, whatever level the draft gave it.
      const level = id === 'summary' ? 2 : Math.min(Math.max(h[1]!.length, 2), 4)
      const text = sentenceCase(raw)
      if (toc && (level === 2 || id === 'summary')) toc.push({ id, text })
      out.push(`<h${level} id="${id}">${inline(text, preview)}</h${level}>`)
      i++
      continue
    }

    if (isTable(line)) {
      const rows: string[][] = []
      while (i < lines.length && isTable(lines[i]!)) {
        const cells = lines[i]!.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells)
        i++
      }
      const [head, ...body] = rows
      const th = (head ?? []).map((c) => `<th>${inline(c, preview)}</th>`).join('')
      // data-label: phones show each row as a card of "header: value" lines.
      const labels = (head ?? []).map((c) => escapeHtml(c.replace(/\*\*/g, '')))
      const trs = body.map((r) => `<tr>${r.map((c, j) => `<td data-label="${labels[j] ?? ''}">${inline(c, preview)}</td>`).join('')}</tr>`).join('')
      out.push(`<div class="legal-table"><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`)
      continue
    }

    if (isQuote(line)) {
      const inner: string[] = []
      while (i < lines.length && isQuote(lines[i]!)) inner.push(lines[i++]!.replace(/^\s*>\s?/, ''))
      out.push(`<blockquote>${renderBlocks(inner, doc, preview, null, used)}</blockquote>`)
      continue
    }

    if (isUl(line) || isOl(line)) {
      const ordered = isOl(line)
      const items: string[] = []
      while (i < lines.length && (ordered ? isOl(lines[i]!) : isUl(lines[i]!))) {
        const l = lines[i]!
        const nested = /^\s{2,}/.test(l)
        const num = /^\s*(\d+)\./.exec(l)?.[1]
        const text = l.replace(/^\s*(?:[-*•]|\d+\.)\s+/, '')
        items.push(`<li${ordered && num ? ` value="${num}"` : ''}${nested ? ' class="nested"' : ''}>${inline(text, preview)}</li>`)
        i++
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`)
      continue
    }

    // Paragraph: consecutive plain lines; each line break is kept.
    const para: string[] = []
    while (
      i < lines.length && lines[i]!.trim()
      && !isHeading(lines[i]!) && !isRule(lines[i]!) && !isTable(lines[i]!) && !isQuote(lines[i]!)
      && !(para.length && (isUl(lines[i]!) || isOl(lines[i]!)))
    ) para.push(lines[i++]!)
    out.push(`<p>${para.map((p) => inline(p, preview)).join('<br>')}</p>`)
  }
  return out.join('\n')
}

export function renderLegalMarkdown(doc: LegalDoc, md: string, preview = false): Omit<RenderedLegalDoc, 'textSha256'> {
  const lines = md.split('\n')
  let i = 0
  while (i < lines.length && !lines[i]!.trim()) i++
  let title = ''
  const subtitle: string[] = []
  const t = /^#\s+(.*)$/.exec(lines[i] ?? '')
  if (t) {
    title = sentenceCase(t[1]!.trim())
    i++
    for (let s: RegExpExecArray | null; (s = /^##\s+(.*)$/.exec(lines[i] ?? '')); i++) subtitle.push(s[1]!.trim())
  }
  const toc: LegalTocItem[] = []
  const html = renderBlocks(lines.slice(i), doc, preview, toc, new Set())
  return { title, subtitle: subtitle.join(' '), toc, html }
}

/** The operator's details for one language (the _RU variants override for Russian). */
function entityValues(cfg: LegalConfig, locale: Locale): Record<string, string> {
  const pick = (base: keyof LegalConfig, ru: keyof LegalConfig) =>
    String((locale === 'ru' && cfg[ru]) || cfg[base] || '').trim()
  const address = pick('entityAddress', 'entityAddressRu')
  return {
    name: pick('entityName', 'entityNameRu'),
    inn: String(cfg.entityInn ?? '').trim(),
    registration: pick('entityRegistration', 'entityRegistrationRu'),
    address,
    postalAddress: pick('entityPostalAddress', 'entityPostalAddressRu') || address,
    phone: String(cfg.entityPhone ?? '').trim(),
    email: String(cfg.entityEmail ?? '').trim() || 'hello@memour.uz',
    bank: pick('entityBank', 'entityBankRu'),
  }
}

/** Tokens → the operator's details; a missing one stays an open placeholder "[—]". */
function fillEntity(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{entity\.(\w+)\}\}/g, (_, key: string) => values[key] || '[—]')
}

const cache = new Map<string, RenderedLegalDoc>()

async function loadMarkdown(doc: LegalDoc, locale: Locale): Promise<string | null> {
  const raw = await useStorage('assets:server').getItemRaw(`legal/${locale}/${doc}.md`)
  return raw ? Buffer.from(raw as Uint8Array).toString('utf8') : null
}

/**
 * The full document, filled in and rendered — or null when it must not
 * be shown (not published and no preview).
 */
export async function getLegalDoc(doc: LegalDoc, locale: Locale): Promise<(RenderedLegalDoc & { preview: boolean }) | null> {
  const cfg = (useRuntimeConfig().public.legal ?? {}) as LegalConfig
  const live = legalDocsLive(cfg)
  const preview = !live && legalPreview(cfg)
  if (!live && !preview) return null

  const values = entityValues(cfg, locale)
  const key = `${doc}:${locale}:${preview}:${JSON.stringify(values)}`
  let hit = cache.get(key)
  if (!hit) {
    const source = await loadMarkdown(doc, locale)
    if (!source) return null
    const md = fillEntity(source, values)
    hit = {
      ...renderLegalMarkdown(doc, md, preview),
      textSha256: createHash('sha256').update(md).digest('hex'),
    }
    cache.set(key, hit)
  }
  return { ...hit, preview }
}

/** sha256 of the published text a person accepted, for the consent log (null for interim pages). */
export async function legalTextSha256(doc: LegalDoc, locale: Locale): Promise<string | null> {
  const cfg = (useRuntimeConfig().public.legal ?? {}) as LegalConfig
  if (!legalDocsLive(cfg)) return null
  return (await getLegalDoc(doc, locale))?.textSha256 ?? null
}
