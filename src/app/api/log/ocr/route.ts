import { createClient } from '@/lib/supabase/server'
import { getUserFacility, canScanLogs } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { NextRequest } from 'next/server'

export const maxDuration = 120
export const dynamic = 'force-dynamic'

const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_FILE_COUNT = 20

const BASE_INSTRUCTION = `You are reading a handwritten salon log sheet from a senior living facility. Extract ALL information you can read from this sheet.

Return ONLY a valid JSON object with this exact shape:
{
  "date": "YYYY-MM-DD or null if not found",
  "stylistName": "name of stylist if shown on sheet header or null",
  "entries": [
    {
      "residentName": "string",
      "roomNumber": "string or null",
      "serviceName": "string",
      "additionalServices": ["string"],
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
- price is a number in dollars (not cents), or null if not readable. The price column contains the EXACT dollar amount charged for all services on that row combined. Extract it precisely — never estimate or default. If you cannot read the price clearly, set price to null.
- Include ALL notes written next to any entry
- Never skip entries even if unclear
- COMBINED SERVICES: when an entry lists multiple services joined by "+", "/", "&", "and", or commas between service terms (e.g. "Shampoo + Cut", "Wash/Color", "Curl and Cut", "Cut, Color"), put the FIRST term in "serviceName" and the REST in "additionalServices" as an array of strings. If only one service, use an empty array [] for additionalServices.
- Examples:
  - "Shampoo + Long Hair" → serviceName: "Shampoo", additionalServices: ["Long Hair"]
  - "Cut / Color" → serviceName: "Cut", additionalServices: ["Color"]
  - "Wash, Curl, Chin" → serviceName: "Wash", additionalServices: ["Curl", "Chin"]
  - "Perm" → serviceName: "Perm", additionalServices: []
- For residentName: write the full name exactly as you can read it. If handwriting is unclear, make your best attempt — do NOT return letter-by-letter gibberish like "KBARBdY". If you truly cannot read a name, return "Unclear" as the name. Names are people's names — they follow normal naming patterns.
- Return ONLY the JSON, no markdown, no explanation`

const ABBREVIATIONS = `
Common abbreviations used on these sheets:
- S/ or Sh = Shampoo
- B.Dry or BiDry or BDry or BD = Blow Dry
- Set = Set (roller set or style)
- Cut or Ct = Cut/Haircut
- Mani or mani = Manicure
- Pedi = Pedicure
- Col or Clr or Clor = Color
- Hl or Hi = Highlight
- Cond = Conditioner treatment
- Brows = Eyebrow wax/trim
- Perm = Permanent wave
- Tint = Hair color/tint`

function buildInstruction(knownServices: { name: string; priceCents: number }[]): string {
  if (knownServices.length === 0) return BASE_INSTRUCTION + ABBREVIATIONS
  const serviceList = knownServices
    .map(s => `- ${s.name} ($${(s.priceCents / 100).toFixed(2)})`)
    .join('\n')
  return BASE_INSTRUCTION + ABBREVIATIONS + `

Known services at this facility (match against these):
${serviceList}

IMPORTANT: Expand all abbreviations using the known services list above. Use the price as a strong signal — if the written price matches a known service closely, prefer that service name. For serviceName and additionalServices: return the FULL expanded name that best matches a known service, or your best expansion if no close match exists. Never return raw abbreviations like "S/BDry" or "BiDry".`
}

async function callGemini(base64: string, mimeType: string, apiKey: string, instruction: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`
  const body = {
    contents: [{
      parts: [
        { inlineData: { mimeType: mimeType, data: base64 } },
        { text: instruction + '\n\nExtract all appointments from this log sheet. Return ONLY the JSON object with date, stylistName, and entries array.' },
      ],
    }],
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Gemini API error ${res.status}: ${errText}`)
  }
  const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (!canScanLogs(facilityUser.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const rl = await checkRateLimit('ocr', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    // Verify API key is present
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      console.error('[OCR] GEMINI_API_KEY is not set')
      return Response.json({ error: 'OCR not configured' }, { status: 500 })
    }

    const formData = await request.formData()
    const files = formData.getAll('images') as File[]
    const servicesJson = formData.get('servicesJson') as string | null
    const knownServices: { name: string; priceCents: number }[] = servicesJson ? JSON.parse(servicesJson) : []
    const instruction = buildInstruction(knownServices)
    console.log(`[OCR] Received ${files.length} file(s), ${knownServices.length} known services`)

    if (files.length === 0) return Response.json({ error: 'No images provided' }, { status: 400 })
    if (files.length > MAX_FILE_COUNT) {
      return Response.json({ error: `Too many files (max ${MAX_FILE_COUNT})` }, { status: 413 })
    }
    for (const f of files) {
      if (f.size > MAX_FILE_BYTES) {
        return Response.json({ error: `File too large (max 10MB): ${f.name}` }, { status: 413 })
      }
    }

    // Images + PDFs — Gemini handles PDFs natively via inlineData
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']

    const sheets: unknown[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      console.log(`[OCR] Processing file ${i}: type=${file.type}, size=${file.size} bytes, name=${file.name}`)

      if (!allowedTypes.includes(file.type)) {
        console.warn(`[OCR] File ${i} rejected: unsupported type ${file.type}`)
        sheets.push({ imageIndex: i, error: `Unsupported file type: ${file.type}`, date: null, stylistName: null, entries: [] })
        continue
      }

      try {
        const bytes = await file.arrayBuffer()
        const base64 = Buffer.from(bytes).toString('base64')
        if (file.type === 'application/pdf') {
          console.log(`[OCR] PDF file ${i}: ${(file.size / 1024).toFixed(1)} KB`)
        }
        console.log(`[OCR] Sending file ${i} to Gemini (${base64.length} base64 chars)`)

        const rawText = await Promise.race([
          callGemini(base64, file.type, apiKey, instruction),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Gemini timeout after 90s')), 90_000)
          ),
        ])
        console.log(`[OCR] Raw Gemini response for file ${i}:`, rawText.slice(0, 500))

        let parsed: { date: string | null; stylistName: string | null; entries: unknown[] }
        try {
          const cleaned = rawText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
          parsed = JSON.parse(cleaned)
          if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) {
            throw new Error('Response is not an object with entries array')
          }
        } catch (parseErr) {
          console.error(`[OCR] Parse error for file ${i}:`, parseErr, '\nRaw text was:', rawText)
          sheets.push({
            imageIndex: i,
            error: `Could not parse Gemini response: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
            date: null,
            stylistName: null,
            entries: [],
          })
          continue
        }

        console.log(`[OCR] File ${i} parsed OK: ${(parsed.entries as unknown[]).length} entries, date=${parsed.date}`)
        sheets.push({
          imageIndex: i,
          date: parsed.date ?? null,
          stylistName: parsed.stylistName ?? null,
          entries: parsed.entries,
        })
      } catch (err) {
        console.error(`[OCR] Gemini call error for file ${i}:`, err)
        sheets.push({
          imageIndex: i,
          error: `Gemini error: ${err instanceof Error ? err.message : String(err)}`,
          date: null,
          stylistName: null,
          entries: [],
        })
      }
    }

    console.log(`[OCR] Done: ${sheets.length} sheets, ${sheets.filter((s: unknown) => (s as { error?: string }).error).length} errors`)
    return Response.json({ data: { sheets } })
  } catch (err) {
    console.error('POST /api/log/ocr error:', err)
    console.error('Stack:', err instanceof Error ? err.stack : err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
