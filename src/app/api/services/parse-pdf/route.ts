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

    console.log('PDF raw text (first 500):', text.substring(0, 500))

    // ── BUG A FIX: strip preamble up to and including the first "Price" keyword
    // This removes facility name, document title, copyright, etc.
    const firstPriceIdx = text.search(/\bPrice\b/i)
    const afterPreamble = firstPriceIdx >= 0
      ? text.slice(firstPriceIdx + 'Price'.length)
      : text

    // Secondary cleanup: strip remaining boilerplate sentences
    const cleanText = afterPreamble
      .replace(/Services and Prices Subject to Change[^.]*\./gi, '')
      .replace(/Copyright[^.]*\./gi, '')

    // ── BUG B FIX — PASS 1: locate all category headers ─────────────────────
    // Pattern: one or more words starting with capital, immediately before "Price"
    const categoryMatches = [...cleanText.matchAll(/([A-Z][^0-9]+?)\s+Price\b/g)]

    const categoryPositions: Array<{ pos: number; name: string }> = []
    const categoryColorMap = new Map<string, string>()
    let colorIdx = 0

    for (const m of categoryMatches) {
      const name = m[1].trim()
      if (name.length < 2) continue
      categoryPositions.push({ pos: m.index ?? 0, name })
      if (!categoryColorMap.has(name)) {
        categoryColorMap.set(name, PALETTE[colorIdx++ % PALETTE.length])
      }
    }

    categoryPositions.sort((a, b) => a.pos - b.pos)

    // Returns the nearest category header that appears before `pos`
    function getCategoryAt(pos: number): string {
      let best = ''
      for (const cp of categoryPositions) {
        if (cp.pos <= pos) best = cp.name
        else break
      }
      return best
    }

    // ── PASS 2: find all service lines ────────────────────────────────────────
    const rows: Array<{
      name: string
      priceCents: number
      durationMinutes: number
      category: string
      color: string
    }> = []

    const serviceLineRe = /([A-Za-z][A-Za-z\s,'&/\-]{2,}?)\s+(\d{1,3}(?:\.\d{1,2})?)\s*(?=[A-Z]|$)/g
    for (const m of cleanText.matchAll(serviceLineRe)) {
      const rawName = m[1].trim().replace(/\s+/g, ' ')
      const price = parseFloat(m[2])
      if (rawName.length < 3 || price <= 0 || price >= 1000) continue

      // Skip lines that are themselves category headers
      const isCategory = categoryPositions.some(
        (cp) => cp.name.toLowerCase() === rawName.toLowerCase()
      )
      if (isCategory) continue

      const pos = m.index ?? 0
      const category = getCategoryAt(pos)
      const color = category
        ? (categoryColorMap.get(category) ?? PALETTE[0])
        : PALETTE[0]

      rows.push({
        name: rawName,
        priceCents: Math.round(price * 100),
        durationMinutes: 30,
        category,
        color,
      })
    }

    return Response.json({ data: rows })
  } catch (err) {
    console.error('parse-pdf error:', err)
    return Response.json({ error: 'Failed to parse PDF' }, { status: 500 })
  }
}
