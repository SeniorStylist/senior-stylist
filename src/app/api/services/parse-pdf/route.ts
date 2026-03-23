import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { extractText } from 'unpdf'

export const runtime = 'nodejs'

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

    // PDF text comes as one blob — extract name+price pairs directly
    const rows: Array<{ name: string; priceCents: number; durationMinutes: number }> = []

    // Strip boilerplate before matching
    const cleanText = text
      .replace(/Services and Prices Subject to Change[^.]*\./gi, '')
      .replace(/Copyright[^.]*\./gi, '')
      .replace(/Salon Services and Pricing/gi, '')
      .replace(/^[^S]*Shampoo/, 'Shampoo') // trim facility name from start

    // Match: text chunk followed by a price number, lookahead for next capital or end
    const pattern = /([A-Za-z][^0-9]{2,60}?)\s+(\d+(?:\.\d{1,2})?)\s*(?:ea\.?)?\s*(?=[A-Z]|$)/g

    let match
    while ((match = pattern.exec(cleanText)) !== null) {
      const name = match[1].trim().replace(/\s+/g, ' ')
      const price = parseFloat(match[2])

      // Skip section headers and boilerplate
      if (/\bPrice\b$/i.test(name)) continue
      if (/^(Color|Perms|Relaxers|Nail|Additional|Aesthetics)$/i.test(name)) continue
      if (name.length < 3 || price <= 0 || price >= 1000) continue

      rows.push({ name, priceCents: Math.round(price * 100), durationMinutes: 30 })
    }

    return Response.json({ data: rows })
  } catch (err) {
    console.error('parse-pdf error:', err)
    return Response.json({ error: 'Failed to parse PDF' }, { status: 500 })
  }
}
