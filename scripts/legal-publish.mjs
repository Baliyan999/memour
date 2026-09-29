#!/usr/bin/env node
/**
 * Build the publishable legal texts from the owner's drafts.
 *
 *   node scripts/legal-publish.mjs [--drafts <dir>]
 *
 * Reads {uz,ru}/{privacy,terms,offer}.md from the drafts folder (kept
 * OUTSIDE this public repo; default ../memour-legal-drafts next to the
 * repo, or $LEGAL_DRAFTS_DIR) and writes:
 *
 *   server/assets/legal/{uz,ru}/{doc}.md  — the text as it may be published
 *   shared/legal-meta.json                — version, open placeholders and
 *                                           open owner notes (todo) per doc
 *
 * What it removes — nothing of this may ever reach the repo:
 *   - HTML comments and everything above the first "---" except the
 *     title (internal note, draft edition lines, release checklist);
 *   - sections whose heading says they are internal or not published
 *     (legal bases, pre-publication checklists, temporary wordings,
 *     interface texts), up to the next heading of the same level;
 *   - every owner marker [ПРОВЕРИТЬ …], [СДЕЛАТЬ …], [BAJARISH …],
 *     [TEKSHIRISH …] (nested brackets and line breaks included), and
 *     every bracket that says what to do before publication
 *     ("[ВЫБРАТЬ ОДИН ВАРИАНТ ДО ПУБЛИКАЦИИ.]", "[EʼLON QILISHDAN
 *     OLDIN …]"); a paragraph or quote that STARTS with a marker is an
 *     internal note as a whole and goes entirely.
 *
 * What it fills in:
 *   - the operator's details become {{entity.*}} tokens, which the
 *     server fills from runtime config (NUXT_PUBLIC_LEGAL_ENTITY_*);
 *   - link-text placeholders ([Политика конфиденциальности] …) become
 *     links to the site's pages.
 *
 * What blocks publication (shared/legal.ts) — the site keeps serving
 * the short interim pages while any count is above zero:
 *   - open: every other bracket left in the text (a price to confirm,
 *     a variant to choose);
 *   - todo: what the text must not be published with even once the
 *     brackets are filled —
 *       · every marker removed above: each is a statement the drafts
 *         themselves say is not true or not settled yet. The owner
 *         deletes the marker in the draft once it is done (or rewrites
 *         the sentence), and it stops counting;
 *       · references to an appendix this script removed ("Приложение
 *         А", "A-ilova" in the privacy policy);
 *       · links to pages the site doesn't have (/legal/consent-couple,
 *         memour.uz/x …) — checked against app/pages.
 * Both are listed below the counts; read the list before publishing.
 *
 * All documents are built in memory first; if any of them fails, no
 * file is written.
 *
 * The version of a document is the date its generated text last
 * changed (a second change on the same day gets ".2", ".3" …);
 * consent records store it (shared/legal.ts).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DOCS = ['privacy', 'terms', 'offer']
const LOCALES = ['uz', 'ru']
const OUT_DIR = join(ROOT, 'server/assets/legal')
const META_FILE = join(ROOT, 'shared/legal-meta.json')

const argIdx = process.argv.indexOf('--drafts')
const DRAFTS = resolve(
  argIdx > 0 ? process.argv[argIdx + 1] : process.env.LEGAL_DRAFTS_DIR || join(ROOT, '..', 'memour-legal-drafts'),
)

// A heading that marks an internal section (ru / uz wording of the drafts).
const INTERNAL_HEADING = [
  /НЕ\s+ПУБЛИКУ/i,
  /НЕ\s+ПУБЛИКОВАТЬ/i,
  /внутренн\S*\s+использовани/i,
  /КОНФИДЕНЦИАЛЬНО/,
  /для\s+команды/i,
  /E[ʼ']?LON\s+QILINMAYDI/i,
  /ichki\s+foydalanish/i,
  /\bMAXFIY\b/,
  /jamoa\s+uchun/i,
]
// Sections that are not marked internal but are not part of the page.
const EXCLUDED_HEADING = {
  // "Приложение А. Тексты для интерфейса" — texts for the site's screens.
  privacy: [/^Приложение\s+А[.\s]/, /^A-ilova\b/],
  terms: [],
  offer: [],
}
const MARKER = /^\[\s*\**\s*(ПРОВЕРИТЬ|СДЕЛАТЬ|BAJARISH|TEKSHIRISH)/
// "[ВЫБРАТЬ ОДИН ВАРИАНТ ДО ПУБЛИКАЦИИ.]" — an instruction, not a placeholder.
const PREPUBLICATION = /ДО\s+ПУБЛИКАЦИИ|E[ʼ'’]?LON\s+QILISHDAN\s+OLDIN/
const INTERNAL_QUOTE = /^\**\s*(ВНУТРЕННЯЯ ПОМЕТКА|ICHKI IZOH)/

// "Приложение А.2", "A.2-ilova", "ПРИЛОЖЕНИЕ 4" → the appendix id ("А", "A", "4").
const APPENDIX_HEADING = /^(?:Приложение|ПРИЛОЖЕНИЕ)\s+([\p{L}\d]+)[.\s]|^([\p{L}\d]+)-(?:ilova|ILOVA)\b/u
const appendixRef = (id) =>
  new RegExp(`(?:Приложени\\p{L}*|ПРИЛОЖЕНИ\\p{L}*)\\s+${id}(?![\\p{L}\\d])|(?<![\\p{L}\\d.])${id}(?:\\.\\d+)*-(?:ilova|ILOVA)`, 'gu')

// Operator details → tokens the server fills in at runtime.
const ENTITY_PATTERNS = [
  [/№ \[__\] от \[__\], выдано \[ОРГАН\]/g, '{{entity.registration}}'],
  [/№ \[__\], sanasi: \[__\], bergan organ: \[ОРГАН\]/g, '{{entity.registration}}'],
  [/№ \[НОМЕР\] от \[ДАТА\], \[РЕГИСТРИРУЮЩИЙ ОРГАН\]/g, '{{entity.registration}}'],
  [/№ \[НОМЕР\], sana \[ДАТА\], \[РЕГИСТРИРУЮЩИЙ ОРГАН\]/g, '{{entity.registration}}'],
  [/\[НОМЕР И ДАТА СВИДЕТЕЛЬСТВА, ОРГАН\]/g, '{{entity.registration}}'],
  [/\[БАНКОВСКИЕ РЕКВИЗИТЫ\](?::\s*(?:банк|bank) \[БАНК\], (?:МФО|MFO) \[МФО\], (?:р\/с|h\/r) \[РАСЧЁТНЫЙ СЧЁТ\])?/g, '{{entity.bank}}'],
  // Only the operator's own name: a bare "[ПОЛНОЕ НАИМЕНОВАНИЕ]" (the
  // offer's line about Eskiz) and "[… ОПЕРАТОРА SMS-РАССЫЛОК]" are
  // other companies and stay open.
  [/\[ПОЛНОЕ НАИМЕНОВАНИЕ (?:ОПЕРАТОРА(?! SMS)|С ОРГАНИЗАЦИОННО)[^\]]*\]/g, '{{entity.name}}'],
  [/\[НАИМЕНОВАНИЕ ОПЕРАТОРА\]/g, '{{entity.name}}'],
  [/\[ИНН\]/g, '{{entity.inn}}'],
  [/\[ЮРИДИЧЕСКИЙ АДРЕС\]/g, '{{entity.address}}'],
  [/\[ПОЧТОВЫЙ АДРЕС\]/g, '{{entity.postalAddress}}'],
  [/\[ТЕЛЕФОН\]/g, '{{entity.phone}}'],
  [/hello@memour\.uz/g, '{{entity.email}}'],
]

// Link-text placeholders → links to the site's own pages.
const LINKS = {
  ru: [
    [/\[(Пользовательское соглашение|Пользовательского соглашения|Пользовательским соглашением)\](?!\()/g, '/ru/terms'],
    [/\[(Политик[аиуеой] конфиденциальности|Политикой конфиденциальности)\](?!\()/g, '/ru/privacy'],
    [/\[(Публичн\S+ оферт\S+)\](?!\()/g, '/ru/offer'],
    [/\[(Правил\S* для гостей)\](?!\()/g, '/ru/terms#guest-rules'],
    [/\[ССЫЛКА НА ПОЛИТИКУ\]/g, '/ru/privacy', 'https://memour.uz/ru/privacy'],
    [/\[ССЫЛКА НА ОФЕРТУ\]/g, '/ru/offer', 'https://memour.uz/ru/offer'],
  ],
  uz: [
    [/\[(Foydalanuvchi kelishuvi\S*)\](?!\()/g, '/uz/terms'],
    [/\[(Maxfiylik siyosati\S*)\](?!\()/g, '/uz/privacy'],
    [/\[(Ommaviy oferta\S*)\](?!\()/g, '/uz/offer'],
    [/\[(Mehmonlar uchun qoidalar\S*)\](?!\()/g, '/uz/terms#guest-rules'],
    [/\[ССЫЛКА НА ПОЛИТИКУ\]/g, '/uz/privacy', 'https://memour.uz/uz/privacy'],
    [/\[ССЫЛКА НА ОФЕРТУ\]/g, '/uz/offer', 'https://memour.uz/uz/offer'],
  ],
}

// Nothing like this may survive into a published text: if it does, a
// note was not marked as internal and a person has to look at it.
const FORBIDDEN = [
  /ПРОВЕРИТЬ|СДЕЛАТЬ|BAJARISH|TEKSHIRISH/,
  /ВНУТРЕННЯЯ ПОМЕТКА|ICHKI IZOH/,
  /НЕ ПУБЛИКУ|E[ʼ']LON QILINMAYDI/,
  /GAPS\.md|\.changes\.md|\.review\.md/,
  /\bapp\/(pages|components|layouts|composables)\b|\bserver\/(api|utils)\b|\.vue\b|\bsupabase\/migrations\b/,
]

/** A one-line bracket at `i` that is an instruction for before publication. */
function isPrepublicationNote(text, i) {
  const m = /^\[[^\]\n]{0,200}\]/.exec(text.slice(i, i + 204))
  return !!m && PREPUBLICATION.test(m[0])
}

/** Remove every [MARKER …] span; nested brackets and newlines included. */
function stripMarkers(text, removed) {
  let out = ''
  let i = 0
  while (i < text.length) {
    if (text[i] === '[' && (MARKER.test(text.slice(i, i + 40)) || isPrepublicationNote(text, i))) {
      let depth = 0
      let j = i
      for (; j < text.length; j++) {
        if (text[j] === '[') depth++
        else if (text[j] === ']' && --depth === 0) break
      }
      removed.push(text.slice(i, j + 1).replace(/\s+/g, ' '))
      // A marker set in bold: drop the ** pair around it as well.
      if (out.endsWith('**') && text.slice(j + 1, j + 3) === '**') {
        out = out.slice(0, -2)
        j += 2
      }
      i = j + 1
      continue
    }
    out += text[i++]
  }
  return out
}

/** Split into blocks separated by blank lines (keeps table / list / quote lines together). */
function blocks(text) {
  return text.split(/\n[ \t]*\n/)
}

/** The site's routes (app/pages; "[id]" matches any segment), as path regexes without the locale. */
const PAGES = (function walk(dir, prefix) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return walk(join(dir, e.name), [...prefix, e.name])
    if (!e.name.endsWith('.vue')) return []
    const segs = [...prefix, e.name.slice(0, -4)].filter((s) => s !== 'index')
    return [new RegExp(`^${segs.map((s) => (/^\[.+\]$/.test(s) ? '[^/]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/')}$`)]
  })
})(join(ROOT, 'app/pages'), [])

/** Site paths a line links to: "](/ru/offer)" and bare "memour.uz/…" addresses. */
function siteLinks(line) {
  const out = []
  for (const m of line.matchAll(/\]\((\/[^)\s]*)\)/g)) out.push(m[1])
  for (const m of line.matchAll(/(?<![@\w.-])(?:https?:\/\/)?memour\.uz(\/[^\s)»,;*<]*)?/g)) out.push(m[1] ?? '/')
  return out.map((p) => p.replace(/[.:]+$/, ''))
}

function pageExists(href) {
  const path = href.replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '').replace(/^(uz|ru)(\/|$)/, '')
  return PAGES.some((re) => re.test(path))
}

function headingOf(line) {
  const m = /^(#{1,6})\s+(.*)$/.exec(line)
  return m ? { level: m[1].length, text: m[2].trim() } : null
}

function process1(doc, locale, source, report) {
  let text = source.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '')
  let lines = text.split('\n')

  // Front matter: keep the title headings, drop the rest up to the first rule.
  const firstRule = lines.findIndex((l) => /^---\s*$/.test(l))
  if (firstRule > 0 && firstRule < 60) {
    const titles = lines.slice(0, firstRule).filter((l) => /^#{1,2}\s/.test(l))
    lines = [...titles, '', ...lines.slice(firstRule + 1)]
  }

  // Internal / excluded sections.
  const kept = []
  let skipLevel = 0
  for (const line of lines) {
    const h = headingOf(line)
    if (h) {
      if (skipLevel && h.level <= skipLevel) skipLevel = 0
      if (!skipLevel && (INTERNAL_HEADING.some((re) => re.test(h.text)) || EXCLUDED_HEADING[doc].some((re) => re.test(h.text)))) {
        skipLevel = h.level
        report.sections.push(h.text)
      }
    }
    if (!skipLevel) kept.push(line)
  }
  text = kept.join('\n')

  // Blocks that are internal notes as a whole.
  text = blocks(text)
    .filter((b) => {
      const body = b.trim().replace(/^>\s?/gm, '').trim()
      if (MARKER.test(body.replace(/^\*+\s*/, ''))) {
        report.markers.push(body.replace(/\s+/g, ' '))
        return false
      }
      if (INTERNAL_QUOTE.test(body)) {
        report.sections.push(body.replace(/\s+/g, ' ').slice(0, 80))
        return false
      }
      return true
    })
    .join('\n\n')

  // Inline markers.
  text = stripMarkers(text, report.markers)

  // Tidy what the removals left behind.
  text = text
    .split('\n')
    .map((l) => l.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/, '').replace(/ ([.,;:])/g, '$1'))
    .join('\n')
  const isRule = (b) => /^(---\s*\n?)+$/.test(b.trim() + '\n')
  text = blocks(text)
    .filter((b) => b.replace(/^>\s*$/gm, '').trim() !== '')
    // Runs of rules collapse to one; none at the very end.
    .filter((b, i, all) => !(isRule(b) && (i === all.length - 1 || isRule(all[i + 1]))))
    .map((b) => (isRule(b) ? '---' : b))
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n'

  for (const [re, token] of ENTITY_PATTERNS) text = text.replace(re, token)
  for (const [re, href, literal] of LINKS[locale]) {
    text = text.replace(re, (_, label) => (typeof label === 'string' ? `[${label}](${href})` : literal))
  }

  // Open placeholders: any bracket that isn't a link's text.
  const open = []
  const dangling = []
  const removedAppendices = report.sections.map((s) => APPENDIX_HEADING.exec(s)).filter(Boolean).map((m) => m[1] ?? m[2])
  for (const [i, line] of text.split('\n').entries()) {
    for (const m of line.matchAll(/\[[^\]\n]*\](?!\()/g)) open.push({ line: i + 1, text: m[0] })
    // What the text points at must exist: appendices it still has, pages the site has.
    for (const id of removedAppendices) {
      for (const m of line.matchAll(appendixRef(id))) dangling.push({ line: i + 1, text: `${m[0]} (removed appendix)` })
    }
    for (const href of siteLinks(line)) {
      if (!pageExists(href)) dangling.push({ line: i + 1, text: `${href} (no such page)` })
    }
  }
  report.open = open
  report.dangling = dangling

  for (const re of FORBIDDEN) {
    const m = re.exec(text)
    if (m) {
      const at = text.slice(0, m.index).split('\n').length
      throw new Error(`${locale}/${doc}.md line ${at}: "${m[0]}" must not be published — mark that note in the draft`)
    }
  }
  return text
}

function sha256(s) {
  return createHash('sha256').update(s).digest('hex')
}

function today() {
  // The owner works in Tashkent time.
  return new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10)
}

/** Same text → same version; a changed text never keeps the version it had. */
function nextVersion(prev, hash) {
  if (prev && prev.sha256 === hash) return prev.version
  const date = today()
  if (!prev?.version?.startsWith(date)) return date
  return `${date}.${Number(/\.(\d+)$/.exec(prev.version)?.[1] ?? 1) + 1}`
}

// --- run -------------------------------------------------------------
if (!existsSync(DRAFTS)) {
  console.error(`Drafts folder not found: ${DRAFTS}\nPass --drafts <dir> or set LEGAL_DRAFTS_DIR.`)
  process.exit(1)
}

const oldMeta = existsSync(META_FILE) ? JSON.parse(readFileSync(META_FILE, 'utf8')) : {}
const meta = {}
const outputs = [] // [locale, doc, text] — written only when every document built
let failed = false

const list = (label, items) => {
  const counts = new Map()
  for (const o of items) counts.set(o.text, [...(counts.get(o.text) ?? []), o.line])
  for (const [t, at] of counts) console.log(`  ${label}: ${t}  (line ${at.slice(0, 6).join(', ')}${at.length > 6 ? ', …' : ''})`)
}

for (const doc of DOCS) {
  const texts = {}
  const open = {}
  const todo = {}
  for (const locale of LOCALES) {
    const file = join(DRAFTS, locale, `${doc}.md`)
    const report = { sections: [], markers: [], open: [], dangling: [] }
    try {
      texts[locale] = process1(doc, locale, readFileSync(file, 'utf8'), report)
    } catch (e) {
      console.error(`✗ ${e.message}`)
      failed = true
      continue
    }
    open[locale] = report.open.length
    todo[locale] = report.markers.length + report.dangling.length
    console.log(`\n=== ${locale}/${doc}.md — removed ${report.sections.length} internal sections; ${report.open.length} open placeholders; ${todo[locale]} todo (${report.markers.length} owner notes, ${report.dangling.length} dangling references)`)
    for (const s of report.sections) console.log(`  − section: ${s}`)
    for (const m of report.markers) console.log(`  ! todo: ${m.slice(0, 150)}${m.length > 150 ? '…' : ''}`)
    list('! todo', report.dangling)
    list('? open', report.open)
  }
  if (failed) continue

  const hash = sha256(LOCALES.map((l) => texts[l]).join('\n\u0000\n'))
  const prev = oldMeta[doc]
  meta[doc] = {
    version: nextVersion(prev, hash),
    sha256: hash,
    open,
    todo,
  }
  for (const locale of LOCALES) outputs.push([locale, doc, texts[locale]])
}

if (failed) {
  console.error('\nNothing written. Fix the drafts and run again.')
  process.exit(1)
}
for (const [locale, doc, text] of outputs) {
  mkdirSync(join(OUT_DIR, locale), { recursive: true })
  writeFileSync(join(OUT_DIR, locale, `${doc}.md`), text)
}
writeFileSync(META_FILE, JSON.stringify(meta, null, 2) + '\n')
console.log(`\nWrote server/assets/legal/{uz,ru}/*.md and shared/legal-meta.json`)
const blocked = DOCS.filter((d) => LOCALES.some((l) => meta[d].open[l] > 0 || meta[d].todo[l] > 0))
if (blocked.length) {
  console.log(`Not publishable yet: ${blocked.map((d) => `${d} (open ${LOCALES.map((l) => meta[d].open[l]).join('/')}, todo ${LOCALES.map((l) => meta[d].todo[l]).join('/')} uz/ru)`).join(', ')}.`)
  console.log('The site keeps the interim pages until every placeholder is filled and every todo above is resolved in the drafts.')
}
