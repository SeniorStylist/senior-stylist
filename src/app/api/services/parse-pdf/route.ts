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

    // Parse lines looking for service name + price patterns
    const rows: Array<{ name: string; priceCents: number; durationMinutes: number }> = []

    // Matches: "Service Name  $25" or "Service Name 25.00" or "Service Name 15 ea." or "Service Name 22*"
    const linePattern = /^(.+?)\s+\$?(\d+(?:\.\d{1,2})?)\s*(?:ea\.?|\*)?\s*$/

    const lines = text.split('\n').map((l: string) => l.trim()).filter(Boolean)

    // Skip the first 2 lines (usually facility name / document title)
    const dataLines = lines.slice(2)

    for (const line of dataLines) {
      // Skip header/boilerplate lines
      if (/\bPrice\b/i.test(line)) continue
      if (/Subject to Change/i.test(line)) continue
      if (/Copyright/i.test(line)) continue
      // Skip lines that are all-caps (section headers like "COLOR", "NAILS")
      if (line === line.toUpperCase() && /[A-Z]/.test(line)) continue

      const match = line.match(linePattern)
      if (!match) continue

      const name = match[1].replace(/[.\-_]+$/, '').trim()
      const price = parseFloat(match[2])

      // Skip names that are too short or look like headers
      if (name.length < 3) continue
      if (/^Service\b/i.test(name)) continue

      if (price > 0 && price < 1000) {
        rows.push({ name, priceCents: Math.round(price * 100), durationMinutes: 30 })
      }
    }

    return Response.json({ data: rows })
  } catch (err) {
    console.error('parse-pdf error:', err)
    return Response.json({ error: 'Failed to parse PDF' }, { status: 500 })
  }
}
