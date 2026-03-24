import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { extractText } from 'unpdf'

export const runtime = 'nodejs'

const PALETTE = ['#0D7377','#7C3AED','#DC2626','#DB2777','#D97706','#059669','#2563EB','#0891B2','#9333EA','#EA580C','#16A34A','#0284C7']

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
    getColor(currentCategory)

    const rows: Array<{
      name: string
      priceCents: number
      durationMinutes: number
      category: string
      color: string
    }> = []

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
        if (chunk.length >= 3 && !chunk.startsWith('*') && !/^Price\b/i.test(chunk)) {
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

      rows.push({
        name: serviceName,
        priceCents: Math.round(price * 100),
        durationMinutes: 30,
        category: currentCategory,
        color: getColor(currentCategory),
      })
    }

    return Response.json({ data: rows })
  } catch (err) {
    console.error('parse-pdf error:', err)
    return Response.json({ error: 'Failed to parse PDF' }, { status: 500 })
  }
}
