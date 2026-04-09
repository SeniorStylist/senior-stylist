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

// Match "add $X to service amount" pattern
const ADDON_RE = /^(.+?)\s+add\s+\$?(\d+(?:\.\d{1,2})?)\s+to\s+service\s+amount$/i

// Match "Name X-Y $Z ea. / Y+ $W ea." tiered pattern
// e.g. "Corn Rows 1-4 $8 ea. 5 or more $5 ea."
const TIERED_RE = /^(.+?)\s+(\d+)\s*-\s*(\d+)\s+\$?(\d+(?:\.\d{1,2})?)\s*ea\.?\s+(\d+)\s+or\s+more\s+\$?(\d+(?:\.\d{1,2})?)\s*ea\.?$/i

// Match "Name ... X ea. -or- Y for all Z" multi-option pattern
// e.g. "Hair Removal - Brow, Chin, Lip, Ear 15 ea. -or- 40 for all 4"
const MULTI_OPTION_RE = /^(.+?)\s+(\d+(?:\.\d{1,2})?)\s*ea\.?\s*-or-\s*(\d+(?:\.\d{1,2})?)\s+for\s+all\s+(\d+)$/i

/**
 * Check if a raw service name + price string contains a special pricing pattern.
 * Returns pricing metadata or null if it's a standard fixed-price service.
 */
function detectPricingPattern(rawName: string): ParsedService | null {
  const name = rawName.replace(/\s+/g, ' ').trim()

  // "Updo add $10 to service amount" → addon
  const addonMatch = name.match(ADDON_RE)
  if (addonMatch) {
    return {
      name: addonMatch[1].trim(),
      priceCents: 0,
      durationMinutes: 30,
      category: '',
      color: '',
      pricingType: 'addon',
      addonAmountCents: Math.round(parseFloat(addonMatch[2]) * 100),
      pricingTiers: null,
      pricingOptions: null,
    }
  }

  // "Corn Rows 1-4 $8 ea. 5 or more $5 ea." → tiered
  const tieredMatch = name.match(TIERED_RE)
  if (tieredMatch) {
    const minQty1 = parseInt(tieredMatch[2])
    const maxQty1 = parseInt(tieredMatch[3])
    const price1 = Math.round(parseFloat(tieredMatch[4]) * 100)
    const minQty2 = parseInt(tieredMatch[5])
    const price2 = Math.round(parseFloat(tieredMatch[6]) * 100)
    return {
      name: tieredMatch[1].trim(),
      priceCents: price1,
      durationMinutes: 30,
      category: '',
      color: '',
      pricingType: 'tiered',
      addonAmountCents: null,
      pricingTiers: [
        { minQty: minQty1, maxQty: maxQty1, unitPriceCents: price1 },
        { minQty: minQty2, maxQty: 999, unitPriceCents: price2 },
      ],
      pricingOptions: null,
    }
  }

  // "Hair Removal - Brow, Chin, Lip, Ear 15 ea. -or- 40 for all 4" → multi_option
  const multiMatch = name.match(MULTI_OPTION_RE)
  if (multiMatch) {
    const eachPrice = Math.round(parseFloat(multiMatch[2]) * 100)
    const allPrice = Math.round(parseFloat(multiMatch[3]) * 100)
    const allCount = parseInt(multiMatch[4])
    return {
      name: multiMatch[1].trim(),
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
    }
  }

  return null
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
    const { text } = await extractText(new Uint8Array(buffer), { mergePages: true })

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
    // that looks like a category (may contain commas, &, apostrophes, spaces)
    const cleanFirstCategory = (() => {
      const m = rawFirstCategory.match(/([A-Z][^0-9]+)$/)
      return m ? m[1].trim() : rawFirstCategory
    })()

    const workingBlob = firstPricePos >= 0
      ? stripped.slice(firstPricePos + PRICE_SEP.length)
      : stripped

    // ── Step 3: Split on price numbers (capture group keeps prices in array) ─
    // Result: [text0, price0, text1, price1, ..., textN]
    // Even indices = text chunks, odd indices = price strings
    const tokens = workingBlob.split(/(\d{1,3}(?:\.\d{1,2})?\s*(?:ea\.?)?)/)

    // ── Step 4: Walk text chunks, detect category changes, emit services ─────
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

    // ── Bug 1 fix: Check if there are text chunks BEFORE the first price ─────
    // When the first token (index 0) has no price following it AND is before
    // the first " Price " separator, it may itself be a category header.
    // The cleanFirstCategory extraction above already handles the case where
    // " Price " exists. But when the blob starts with text that has no price,
    // we need to check if token[0] is a bare category header.

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
        // Category detection: >= 3 chars, not *, not "$", not bare "Price"
        if (chunk.length >= 3 && !chunk.startsWith('*') && !chunk.includes('$') && !/^Price\b/i.test(chunk)) {
          currentCategory = chunk
          getColor(chunk)
        }
        continue
      }

      // Parse the numeric price value (ignore "ea." suffix)
      const priceMatch = priceStr.match(/(\d{1,3}(?:\.\d{1,2})?)/)
      if (!priceMatch) continue
      const price = parseFloat(priceMatch[1])
      if (price <= 0 || price >= 1000) continue

      // Normalise service name whitespace
      serviceName = serviceName.replace(/\s+/g, ' ').trim()

      // Skip garbage: too short, footnotes (*), bare "Price" labels
      if (serviceName.length < 3) continue
      if (serviceName.startsWith('*')) continue
      if (/^Price\b/i.test(serviceName)) continue

      // ── Bug 2 fix: Detect special pricing patterns ──────────────────────
      // Reassemble the full raw text including the price for pattern detection
      const fullRaw = serviceName + ' ' + priceStr
      const pricingResult = detectPricingPattern(fullRaw)

      if (pricingResult) {
        // Special pricing detected — use parsed result
        rows.push({
          ...pricingResult,
          category: currentCategory,
          color: getColor(currentCategory),
        })
      } else {
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
    }

    return Response.json({ data: rows })
  } catch (err) {
    console.error('parse-pdf error:', err)
    return Response.json({ error: 'Failed to parse PDF' }, { status: 500 })
  }
}
