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

    console.log('PDF raw text:', text.substring(0, 500))

    // Strip boilerplate
    const cleanText = text
      .replace(/Services and Prices Subject to Change[^.]*\./gi, '')
      .replace(/Copyright[^.]*\./gi, '')
      .replace(/Salon Services and Pricing/gi, '')
      .replace(/^[^S]*(?=Shampoo|Color|Perm|Nail|Hair|Wax|Skin|Facial)/i, '')

    // State: current category and color map
    let currentCategory = ''
    let categoryColorIdx = -1
    const categoryColorMap = new Map<string, string>()

    function getOrAssignColor(cat: string): string {
      if (!categoryColorMap.has(cat)) {
        categoryColorIdx++
        categoryColorMap.set(cat, PALETTE[categoryColorIdx % PALETTE.length])
      }
      return categoryColorMap.get(cat)!
    }

    function setCategory(name: string) {
      const cat = name.trim()
      if (cat.length >= 2) {
        currentCategory = cat
        getOrAssignColor(cat)
      }
    }

    const rows: Array<{ name: string; priceCents: number; durationMinutes: number; category: string; color: string }> = []

    function emitService(rawName: string, price: number) {
      let name = rawName.trim().replace(/\s+/g, ' ')

      // Category-prefix heuristic: if name starts with a single word (no comma)
      // followed by a comma'd phrase, that leading word is likely a new category
      const prefixMatch = name.match(/^([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+([A-Z].+,.+)$/)
      if (prefixMatch) {
        setCategory(prefixMatch[1])
        name = prefixMatch[2].trim()
      }

      if (name.length < 3 || price <= 0 || price >= 1000) return
      const color = currentCategory ? getOrAssignColor(currentCategory) : PALETTE[0]
      rows.push({ name, priceCents: Math.round(price * 100), durationMinutes: 30, category: currentCategory, color })
    }

    // Split blob at every "digit → space → capital" boundary
    const segments = cleanText.split(/(?<=\d+(?:\.\d{1,2})?)\s+(?=[A-Z])/)

    for (const seg of segments) {
      const trimmed = seg.trim()
      if (!trimmed) continue

      // A) Contains " Price " in the middle → "CATEGORY Price SERVICE NUMBER"
      const priceKeywordMid = trimmed.match(/^(.+?)\s+Price\s+(.+?)\s+(\d+(?:\.\d{1,2})?)$/)
      if (priceKeywordMid) {
        setCategory(priceKeywordMid[1])
        emitService(priceKeywordMid[2], parseFloat(priceKeywordMid[3]))
        continue
      }

      // B) Ends with " Price" (trailing) → pure category header
      const priceKeywordEnd = trimmed.match(/^(.+?)\s+Price\s*$/)
      if (priceKeywordEnd) {
        setCategory(priceKeywordEnd[1])
        continue
      }

      // C) Ends with a number → service line
      const serviceMatch = trimmed.match(/^(.+?)\s+(\d+(?:\.\d{1,2})?)$/)
      if (serviceMatch) {
        emitService(serviceMatch[1], parseFloat(serviceMatch[2]))
        continue
      }

      // D) No number → pure category header
      setCategory(trimmed)
    }

    return Response.json({ data: rows })
  } catch (err) {
    console.error('parse-pdf error:', err)
    return Response.json({ error: 'Failed to parse PDF' }, { status: 500 })
  }
}
