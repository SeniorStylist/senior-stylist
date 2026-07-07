// scripts/check-tours.ts
//
// Static health check for guided tours. Walks every step in TOUR_DEFINITIONS
// (from src/lib/help/tours.ts) and verifies that each non-empty `data-tour`
// selector has a matching `data-tour="X"` or `data-tour-mobile="X"` attribute
// somewhere under src/.
//
// Usage:  npx tsx scripts/check-tours.ts
// Exits 1 when any references are missing — safe to wire into CI.

import * as fs from 'node:fs'
import * as path from 'node:path'

const REPO_ROOT = path.resolve(__dirname, '..')
const TOURS_FILE = path.join(REPO_ROOT, 'src/lib/help/tours.ts')
const SRC_DIR = path.join(REPO_ROOT, 'src')

const toursSrc = fs.readFileSync(TOURS_FILE, 'utf8')

// 1. Build constMap: NAV_FOO -> data-tour value
//    Matches lines like:  const NAV_CALENDAR = '[data-tour="nav-calendar"]'
const constMap = new Map<string, string>()
for (const m of toursSrc.matchAll(/^const\s+(\w+)\s*=\s*'\[data-tour="([^"]+)"\]'/gm)) {
  constMap.set(m[1], m[2])
}

// 2. Walk TOUR_DEFINITIONS line-by-line, tracking current tour id and step index.
type Ref = { tourId: string; stepIndex: number; value: string | null }
const refs: Ref[] = []
let inTourDefs = false
let currentTour: string | null = null
let stepIdx = 0

for (const line of toursSrc.split('\n')) {
  if (line.includes('export const TOUR_DEFINITIONS')) { inTourDefs = true; continue }
  if (!inTourDefs) continue

  const tourHeader = line.match(/^\s+'([a-z0-9-]+)':\s*\{/)
  if (tourHeader) { currentTour = tourHeader[1]; stepIdx = 0; continue }

  if (!currentTour) continue
  if (!line.includes('element:')) continue

  stepIdx++
  const litMatch = line.match(/element:\s*'\[data-tour="([^"]+)"\]'/)
  if (litMatch) {
    refs.push({ tourId: currentTour, stepIndex: stepIdx, value: litMatch[1] })
    continue
  }
  if (/element:\s*''/.test(line)) {
    refs.push({ tourId: currentTour, stepIndex: stepIdx, value: null })
    continue
  }
  const constRef = line.match(/element:\s*(\w+)\s*[,}]/)
  if (constRef) {
    const v = constMap.get(constRef[1]) ?? null
    refs.push({ tourId: currentTour, stepIndex: stepIdx, value: v })
    continue
  }
}

// 2b. Phase 12Y — extract `platform: 'mobile' | 'desktop' | 'both'` per tutorial
//     from TUTORIAL_CATALOG. Map tutorial.id → platform. The tutorial.tourId
//     points to a TOUR_DEFINITION; we use that to associate the platform tag
//     with each tour definition.
const tutorialPlatform = new Map<string, 'mobile' | 'desktop' | 'both'>()
for (const m of toursSrc.matchAll(/\{[^}]*?\btourId:\s*'([^']+)'[^}]*?\bplatform:\s*'(mobile|desktop|both)'[^}]*?\}/g)) {
  tutorialPlatform.set(m[1], m[2] as 'mobile' | 'desktop' | 'both')
}

// 3. Collect .ts/.tsx files under src/ (excluding tours.ts itself).
function walk(dir: string, out: string[]): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if ((ent.name.endsWith('.tsx') || ent.name.endsWith('.ts')) && p !== TOURS_FILE) out.push(p)
  }
  return out
}
const files = walk(SRC_DIR, [])

// 4. Search file contents for the anchor value. We accept four forms because
//    sidebar.tsx + mobile-nav.tsx wire data-tour dynamically via a tourSlug
//    ternary chain (`data-tour={tourSlug}` where `tourSlug = ... ? 'nav-calendar' : ...`),
//    so the literal `data-tour="nav-calendar"` never appears in source.
//    Slug names are namespaced (kebab-case, prefixed) — collision risk with
//    arbitrary strings elsewhere is acceptably low.
const searchCache = new Map<string, boolean>()
function found(value: string): boolean {
  if (searchCache.has(value)) return searchCache.get(value)!
  const needles = [
    `data-tour="${value}"`,
    `data-tour-mobile="${value}"`,
    `'${value}'`,
    `"${value}"`,
  ]
  let hit = false
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8')
    if (needles.some((n) => text.includes(n))) { hit = true; break }
  }
  searchCache.set(value, hit)
  return hit
}

// 4b. Phase 12Y — platform context detector. For each selector value, find the
//     source file containing the matching data-tour attribute and look at the
//     surrounding ~12 lines for className patterns that suggest the element is
//     mobile-only (`md:hidden`) or desktop-only (`hidden md:flex/block/grid/inline`).
//     Heuristic only — emits warnings, doesn't fail the script.
type PlatformContext = 'mobile-only' | 'desktop-only' | 'both' | 'unknown'

function detectContext(value: string): PlatformContext {
  const needle = `data-tour="${value}"`
  const altNeedle = `data-tour-mobile="${value}"`
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8')
    const idx = text.indexOf(needle)
    const altIdx = text.indexOf(altNeedle)
    const hit = idx >= 0 ? idx : altIdx
    if (hit < 0) continue
    // Look at ~600 chars before the attribute for class hints in the same JSX element
    const window = text.slice(Math.max(0, hit - 600), hit + 200)
    const isMobileOnly = /\bmd:hidden\b/.test(window)
    const isDesktopOnly = /\bhidden\s+md:(flex|block|grid|inline)\b/.test(window)
    if (isMobileOnly && !isDesktopOnly) return 'mobile-only'
    if (isDesktopOnly && !isMobileOnly) return 'desktop-only'
    return 'both'
  }
  return 'unknown'
}

// 5. Report.
let checked = 0
let okCount = 0
const missing: Ref[] = []
const platformWarnings: { ref: Ref; ctx: PlatformContext; tagged: 'mobile' | 'desktop' | 'both' }[] = []

for (const ref of refs) {
  if (ref.value == null) continue
  checked++
  if (found(ref.value)) {
    okCount++
    console.log(`  ✅ ${ref.tourId}[${ref.stepIndex}]  data-tour="${ref.value}"`)
  } else {
    missing.push(ref)
    console.log(`  ❌ ${ref.tourId}[${ref.stepIndex}]  data-tour="${ref.value}"  NOT FOUND in src/`)
  }

  // Platform-consistency check
  const tagged = tutorialPlatform.get(ref.tourId) ?? 'both'
  if (tagged === 'both') continue
  const ctx = detectContext(ref.value)
  if (ctx === 'unknown' || ctx === 'both') continue
  if (tagged === 'mobile' && ctx === 'desktop-only') {
    platformWarnings.push({ ref, ctx, tagged })
  } else if (tagged === 'desktop' && ctx === 'mobile-only') {
    platformWarnings.push({ ref, ctx, tagged })
  }
}

// 5b. Phase 13 — validate scripted-tour selectors (tours-stylist-{mobile,desktop}.ts + tours-master.ts).
//     Each step has `selector: '[data-tour="X"]'` or `[data-tour-mobile="X"]`.
const SCRIPTED_FILES = [
  path.join(REPO_ROOT, 'src/lib/help/tours-stylist-mobile.ts'),
  path.join(REPO_ROOT, 'src/lib/help/tours-stylist-desktop.ts'),
  path.join(REPO_ROOT, 'src/lib/help/tours-master.ts'),
  path.join(REPO_ROOT, 'src/lib/help/tours-facility-staff.ts'),
  path.join(REPO_ROOT, 'src/lib/help/tours-admin.ts'),
  path.join(REPO_ROOT, 'src/lib/help/tours-bookkeeper.ts'),
  path.join(REPO_ROOT, 'src/lib/help/tours-new-features.ts'),
]
type ScriptedRef = { file: string; value: string }
const scriptedRefs: ScriptedRef[] = []
for (const file of SCRIPTED_FILES) {
  if (!fs.existsSync(file)) continue
  const src = fs.readFileSync(file, 'utf8')
  // Matches both `selector:` and `advanceSelector:` (the typeahead result a
  // type step waits for the user to click).
  for (const m of src.matchAll(/(?:advance)?[sS]elector:\s*'\[data-tour(?:-mobile)?="([^"]+)"\]'/g)) {
    scriptedRefs.push({ file: path.basename(file), value: m[1] })
  }
}
const scriptedMissing: ScriptedRef[] = []
for (const ref of scriptedRefs) {
  checked++
  if (found(ref.value)) {
    okCount++
    console.log(`  ✅ ${ref.file}  data-tour="${ref.value}"`)
  } else {
    scriptedMissing.push(ref)
    console.log(`  ❌ ${ref.file}  data-tour="${ref.value}"  NOT FOUND in src/`)
  }
}

// 5c. Help audit 2026-07-07 — id-resolution validation. Catches the B1 class of
//     bug (catalog/checklist/map ids that resolve to nothing) that selector
//     checks can't see.
const mapSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/help/scripted-tour-map.ts'), 'utf8')

// All legacy TOUR_DEFINITIONS keys ('id': { id: 'x', ... } entries)
const legacyIds = new Set([...toursSrc.matchAll(/^  '([a-z0-9-]+)':\s*\{/gm)].map((m) => m[1]))
// All scripted tour ids across the scripted files
const scriptedIds = new Set<string>()
for (const file of SCRIPTED_FILES) {
  if (!fs.existsSync(file)) continue
  const src = fs.readFileSync(file, 'utf8')
  for (const m of src.matchAll(/id:\s*'(scripted-[a-z0-9-]+)'/g)) scriptedIds.add(m[1])
}
// SCRIPTED_TOUR_MAP: keys + targets
const mapEntries = [...mapSrc.matchAll(/'([a-z0-9-]+)':\s*\{\s*mobile:\s*'([a-z0-9-]+)',\s*desktop:\s*'([a-z0-9-]+)'/g)]
const mapKeys = new Set(mapEntries.map((m) => m[1]))
const idErrors: string[] = []
for (const [, key, mob, desk] of mapEntries) {
  if (!scriptedIds.has(mob)) idErrors.push(`SCRIPTED_TOUR_MAP['${key}'].mobile → '${mob}' not defined in any tours-*.ts`)
  if (!scriptedIds.has(desk)) idErrors.push(`SCRIPTED_TOUR_MAP['${key}'].desktop → '${desk}' not defined in any tours-*.ts`)
}
// Catalog tourIds must resolve to SOME engine (legacy definition or scripted map key)
for (const m of toursSrc.matchAll(/tourId:\s*'([a-z0-9-]+)'/g)) {
  const id = m[1]
  if (!legacyIds.has(id) && !mapKeys.has(id)) {
    idErrors.push(`TUTORIAL_CATALOG tourId '${id}' resolves to NO engine (not in TOUR_DEFINITIONS or SCRIPTED_TOUR_MAP)`)
  }
}
// ONBOARDING_CHECKLIST tourIds must resolve too (aliases count as catalog ids)
const checklistBlock = toursSrc.slice(toursSrc.indexOf('ONBOARDING_CHECKLIST'))
for (const m of checklistBlock.slice(0, checklistBlock.indexOf('\n}\n')).matchAll(/tourId:\s*'([a-z0-9-]+)'/g)) {
  const id = m[1]
  if (!legacyIds.has(id) && !mapKeys.has(id)) {
    idErrors.push(`ONBOARDING_CHECKLIST tourId '${id}' resolves to NO engine`)
  }
}
if (idErrors.length > 0) {
  console.log()
  console.log(`Id-resolution errors (${idErrors.length}):`)
  for (const e of idErrors) console.log(`  ❌ ${e}`)
}

console.log()
console.log(`Tour health check — checked ${checked} selectors, ${okCount} found, ${missing.length + scriptedMissing.length} missing, ${idErrors.length} id errors.`)

if (scriptedMissing.length > 0) {
  console.log()
  console.log('Missing scripted-tour anchors:')
  for (const r of scriptedMissing) console.log(`  - ${r.file}  data-tour="${r.value}"`)
}

if (platformWarnings.length > 0) {
  console.log()
  console.log(`Platform-consistency warnings (${platformWarnings.length}):`)
  for (const w of platformWarnings) {
    console.log(`  ⚠️  ${w.ref.tourId}[${w.ref.stepIndex}]  data-tour="${w.ref.value}"  tagged ${w.tagged} but anchor element is ${w.ctx}`)
  }
}

if (missing.length > 0) {
  console.log()
  console.log('Missing anchors:')
  for (const r of missing) console.log(`  - ${r.tourId}[${r.stepIndex}]  data-tour="${r.value}"`)
}
if (missing.length > 0 || scriptedMissing.length > 0 || idErrors.length > 0) process.exit(1)
process.exit(0)
