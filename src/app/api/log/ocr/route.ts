import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })

    const formData = await request.formData()
    const files = formData.getAll('images') as File[]
    if (files.length === 0) return Response.json({ error: 'No images provided' }, { status: 400 })

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: `You are reading a handwritten salon log sheet from a senior living facility. Extract ALL information you can read from this sheet.

Return ONLY a valid JSON object with this exact shape:
{
  "date": "YYYY-MM-DD or null if not found",
  "stylistName": "name of stylist if shown on sheet header or null",
  "entries": [
    {
      "residentName": "string",
      "roomNumber": "string or null",
      "serviceName": "string",
      "price": 0,
      "notes": "string or null",
      "unclear": false
    }
  ]
}

Rules:
- Preserve the ORDER of entries exactly as they appear
- If a date appears in the header (e.g. 'March 15' or '3/15/26'), extract it as YYYY-MM-DD
- If a stylist name appears in the header, extract it
- For unclear handwriting, include your best guess and set unclear: true
- price is a number in dollars (not cents), or null if not readable
- Include ALL notes written next to any entry
- Never skip entries even if unclear
- Return ONLY the JSON, no markdown, no explanation`,
    })

    const sheets: unknown[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]

      if (!allowedTypes.includes(file.type)) {
        sheets.push({ imageIndex: i, error: 'Unsupported image type', date: null, stylistName: null, entries: [] })
        continue
      }

      try {
        const bytes = await file.arrayBuffer()
        const base64 = Buffer.from(bytes).toString('base64')

        const result = await model.generateContent([
          { inlineData: { data: base64, mimeType: file.type } },
          'Extract all appointments from this log sheet. Return ONLY the JSON object with date, stylistName, and entries array.',
        ])

        const rawText = result.response.text()

        let parsed: { date: string | null; stylistName: string | null; entries: unknown[] }
        try {
          const cleaned = rawText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
          parsed = JSON.parse(cleaned)
          if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) {
            throw new Error('Invalid shape')
          }
        } catch {
          sheets.push({ imageIndex: i, error: 'Could not parse Gemini response', date: null, stylistName: null, entries: [] })
          continue
        }

        sheets.push({
          imageIndex: i,
          date: parsed.date ?? null,
          stylistName: parsed.stylistName ?? null,
          entries: parsed.entries,
        })
      } catch (err) {
        console.error(`OCR error for image ${i}:`, err)
        sheets.push({ imageIndex: i, error: 'Gemini error', date: null, stylistName: null, entries: [] })
      }
    }

    return Response.json({ data: { sheets } })
  } catch (err) {
    console.error('POST /api/log/ocr error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
