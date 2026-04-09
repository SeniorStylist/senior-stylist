import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { extractText } from 'unpdf'

export const runtime = 'nodejs'

const PALETTE = ['#0D7377','#7C3AED','#DC2626','#DB2777','#D97706','#059669','#2563EB','#0891B2','#9333EA','#EA580C','#16A34A','#0284C7']

interface ParsedService {
  name: string
  priceCents: number
  durationMinutes: number
  category: string
  color: string
  pricingType: 'fixed' | 'addon' | 'tiered' | 'multi_option'
  addonAmountCents: number | null
  pricingTiers: Array<{ minQty: number; maxQty: number; unitPriceCents: number }> | null
  pricingOptions: Array<{ name: string; priceCents: number }> | null
}

// ── Global pre-extraction regexes ────────────────────────────────────────────
// These run on the FULL workingBlob BEFORE the alternating-chunks split.
// Entries with embedded numbers (addon amounts, tiered ranges) would desync
// the split algorithm — pre-extraction replaces them with letter-only
// placeholders so the split sees no embedded digits.

// "Updo add 10 to service amount" → addon
// Character class includes () so names like "Long Hair (longer than shoulder length)" match
const ADDON_GLOBAL = /([A-Za-z][A-Za-z\s,'()\-]*?)\s+add\s+\$?(\d+(?:\.\d{1,2})?)\s+to\s+service\s+amount/gi

// "Corn Rows 1-4 8 ea. 5 or more 5 ea." → tiered
const TIERED_GLOBAL = /([A-Za-z][A-Za-z\s,'\-]*?)\s+(\d+)\s*-\s*(\d+)\s+\$?(\d+(?:\.\d{1,2})?)\s*ea\.?\s+(\d+)\s+or\s+more\s+\$?(\d+(?:\.\d{1,2})?)\s*ea\.?/gi

// "Hair Removal - Brow, Chin, Lip, Ear 15 ea. -or- 40 for all 4" → multi_option
const MULTI_OPTION_GLOBAL = /([A-Za-z][A-Za-z\s,'\-]+?)\s+(\d+(?:\.\d{1,2})?)\s*ea\.?\s*-or-\s*(\d+(?:\.\d{1,2})?)\s+for\s+all\s+(\d+)/gi

/** Generate next placeholder ID: SVCPHA, SVCPHB, ... SVCPHZ, SVCPHAA, ... */
function nextPlaceholder(counter: number): string {
  let id = ''
  let n = counter
  do {
    id = String.fromCharCode(65 + (n % 26)) + id
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return 'SVCPH' + id
}

/**
 * Pre-extract special pricing entries from the blob before the alternating split.
 * Returns the updated blob (with letter-only placeholders + dummy price "1")
 * and a Map of stored services keyed by placeholder ID.
 */
function preExtractSpecialPricing(blob: string): {
  blob: string
  specialServices: Map<string, ParsedService>
} {
  const specialServices = new Map<string, ParsedService>()
  let counter = 0

  // Extract tiered patterns first — they're more specific and longer, so
  // they must be matched before addon patterns accidentally consume part of them
  blob = blob.replace(TIERED_GLOBAL, (_match, name, min1Str, max1Str, price1Str, min2Str, price2Str) => {
    const placeholder = nextPlaceholder(counter++)
    const price1 = Math.round(parseFloat(price1Str) * 100)
    const price2 = Math.round(parseFloat(price2Str) * 100)
    specialServices.set(placeholder, {
      name: name.trim(),
      priceCents: price1,
      durationMinutes: 30,
      category: '',
      color: '',
      pricingType: 'tiered',
      addonAmountCents: null,
      pricingTiers: [
        { minQty: parseInt(min1Str), maxQty: parseInt(max1Str), unitPriceCents: price1 },
        { minQty: parseInt(min2Str), maxQty: 999, unitPriceCents: price2 },
      ],
      pricingOptions: null,
    })
    return placeholder + ' 1'
  })

  // Extract multi_option patterns
  blob = blob.replace(MULTI_OPTION_GLOBAL, (_match, name, eachStr, allStr, countStr) => {
    const placeholder = nextPlaceholder(counter++)
    const eachPrice = Math.round(parseFloat(eachStr) * 100)
    const allPrice = Math.round(parseFloat(allStr) * 100)
    const allCount = parseInt(countStr)
    specialServices.set(placeholder, {
      name: name.trim(),
      priceCents: eachPrice,
      durationMinutes: 30,
      category: '',
      color: '',
      pricingType: 'multi_option',
      addonAmountCents: null,
      pricingTiers: null,
      pricingOptions: [
        { name: 'Each', priceCents: eachPrice },
        { name: `All ${allCount}`, priceCents: allPrice },
      ],
    })
    return placeholder + ' 1'
  })

  // Extract addon patterns last (shortest, most likely to overlap with others)
  blob = blob.replace(ADDON_GLOBAL, (_match, name, amountStr) => {
    const placeholder = nextPlaceholder(counter++)
    specialServices.set(placeholder, {
      name: name.trim(),
      priceCents: 0,
      durationMinutes: 30,
      category: '',
      color: '',
      pricingType: 'addon',
      addonAmountCents: Math.round(parseFloat(amountStr) * 100),
      pricingTiers: null,
      pricingOptions: null,
    })
    return placeholder + ' 1'
  })

  return { blob, specialServices }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 })

    const buffer = await file.arrayBuffer()

    // ── PDF text extraction via unpdf ─────────────────────────────────────────
    // mergePages: false returns string[] (one string per PDF page object).
    // Join all pages — missing content may be on a separate PDF page object
    // from the one that appears first in mergePages: true output.
    const { text: pages } = await extractText(new Uint8Array(buffer), { mergePages: false })
    const text = pages.join(' ')

    // ── Step 1: Collapse whitespace and strip boilerplate ────────────────────
    const stripped = text
      .replace(/\s+/g, ' ')
      .replace(/Services and Prices Subject to Change[^.]*\./gi, '')
      .replace(/Copyright[^.]*\./gi, '')
      .trim()

    // ── Step 2: Extract first category name (text before first " Price ") ────
    // e.g. "Senior Salon Shampoo, Sets & Cuts Price Shampoo, Blow Dry 28 ..."
    //       → firstCategory candidate = "Senior Salon Shampoo, Sets & Cuts"
    const PRICE_SEP = ' Price '
    const firstPricePos = stripped.indexOf(PRICE_SEP)
    const rawFirstCategory = firstPricePos >= 0
      ? stripped.slice(0, firstPricePos).trim()
      : ''

    // Strip facility name / title preamble — take the last capitalised phrase
    const cleanFirstCategory = (() => {
      const m = rawFirstCategory.match(/([A-Z][^0-9]+)$/)
      return m ? m[1].trim() : rawFirstCategory
    })()

    // Use the full stripped text — the token loop handles " Price " as category
    // separators wherever they appear. Not slicing at the first " Price " avoids
    // dropping content that appears before it due to PDF internal ordering.
    let workingBlob = stripped

    // ── Step 3: Pre-extract special pricing entries BEFORE the split ─────────
    // Replaces addon/tiered/multi_option patterns with letter-only placeholders
    // (e.g. "SVCPHA 1") so the alternating-chunks split never sees embedded
    // digits that would desync the text/price pairing.
    const { blob: cleanedBlob, specialServices } = preExtractSpecialPricing(workingBlob)
    workingBlob = cleanedBlob

    // ── Step 4: Split on price numbers (capture group keeps prices in array) ─
    // Result: [text0, price0, text1, price1, ..., textN]
    // Even indices = text chunks, odd indices = price strings
    const tokens = workingBlob.split(/(\d{1,3}(?:\.\d{1,2})?\s*(?:ea\.?)?)/)

    // ── Step 5: Walk text chunks, detect category changes, emit services ─────
    let colorIdx = -1
    const colorMap = new Map<string, string>()
    function getColor(cat: string): string {
      if (!colorMap.has(cat)) {
        colorIdx++
        colorMap.set(cat, PALETTE[colorIdx % PALETTE.length])
      }
      return colorMap.get(cat)!
    }

    let currentCategory = cleanFirstCategory
    if (currentCategory) getColor(currentCategory)

    const rows: ParsedService[] = []

    for (let i = 0; i < tokens.length; i += 2) {
      const chunk = tokens[i].trim()
      if (!chunk) continue

      const priceStr = i + 1 < tokens.length ? tokens[i + 1].trim() : ''
      const hasPrice = priceStr.length > 0

      // --- Detect category change ---
      // Pattern A: "Color Price Shampoo, Single Process Color" → category + service in same chunk
      // Pattern B: "Men's Price" (no service follows) → pure category header
      let serviceName = chunk

      if (chunk.includes(' Price ')) {
        const sepIdx = chunk.indexOf(' Price ')
        const catPart = chunk.slice(0, sepIdx).trim()
        const svcPart = chunk.slice(sepIdx + ' Price '.length).trim()
        if (catPart) {
          currentCategory = catPart
          getColor(catPart)
        }
        serviceName = svcPart
      } else if (chunk.endsWith(' Price') || chunk === 'Price') {
        // Pure category header e.g. "Men's Price"
        const catName = chunk.replace(/ Price$/, '').trim()
        if (catName) {
          currentCategory = catName
          getColor(catName)
        }
        continue // no service to emit
      }

      if (!hasPrice) {
        // Treat as a bare category header (e.g. "Color", "Perms & Relaxers")
        if (chunk.length >= 3 && !chunk.startsWith('*') && !chunk.includes('$') && !/^Price\b/i.test(chunk)) {
          currentCategory = chunk
          getColor(chunk)
        }
        continue
      }

      // Normalise service name whitespace
      serviceName = serviceName.replace(/\s+/g, ' ').trim()

      // Skip garbage: too short, footnotes (*), bare "Price" labels
      if (serviceName.length < 3) continue
      if (serviceName.startsWith('*')) continue
      if (/^Price\b/i.test(serviceName)) continue

      // ── Placeholder substitution ─────────────────────────────────────────
      // Pre-extracted special services are stored under SVCPH* keys.
      // The dummy price "1" in the blob is irrelevant — use the stored data.
      if (/^SVCPH[A-Z]+$/.test(serviceName)) {
        const stored = specialServices.get(serviceName)
        if (stored) {
          rows.push({ ...stored, category: currentCategory, color: getColor(currentCategory) })
        }
        continue
      }

      // Parse the numeric price value (ignore "ea." suffix)
      const priceMatch = priceStr.match(/(\d{1,3}(?:\.\d{1,2})?)/)
      if (!priceMatch) continue
      const price = parseFloat(priceMatch[1])
      if (price <= 0 || price >= 1000) continue

      // Check if "ea." suffix means multi_option (flag for admin review)
      const isEach = /ea\.?$/i.test(priceStr)

      rows.push({
        name: serviceName,
        priceCents: Math.round(price * 100),
        durationMinutes: 30,
        category: currentCategory,
        color: getColor(currentCategory),
        pricingType: isEach ? 'multi_option' : 'fixed',
        addonAmountCents: null,
        pricingTiers: null,
        pricingOptions: isEach ? [{ name: 'Each', priceCents: Math.round(price * 100) }] : null,
      })
    }

    return Response.json({ data: rows })
  } catch (err) {
    console.error('parse-pdf error:', err)
    return Response.json({ error: 'Failed to parse PDF' }, { status: 500 })
  }
}
