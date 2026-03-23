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

    // Parse lines looking for service name + price patterns
    // Lines that end without a number (category headers) are skipped
    const rows: Array<{ name: string; priceCents: number; durationMinutes: number }> = []
    const linePattern = /^(.+?)\s+\$?(\d+(?:\.\d{1,2})?)\s*$/
    const lines = text.split('\n').map((l: string) => l.trim()).filter(Boolean)

    for (const line of lines) {
      const match = line.match(linePattern)
      if (match) {
        const name = match[1].replace(/[.\-_]+$/, '').trim()
        const price = parseFloat(match[2])
        if (name.length > 0 && price > 0 && price < 1000) {
          rows.push({ name, priceCents: Math.round(price * 100), durationMinutes: 30 })
        }
      }
    }

    return Response.json({ data: rows })
  } catch (err) {
    console.error('parse-pdf error:', err)
    return Response.json({ error: 'Failed to parse PDF' }, { status: 500 })
  }
}
