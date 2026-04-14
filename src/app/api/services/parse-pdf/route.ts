import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { NextRequest } from 'next/server'

const MAX_PDF_BYTES = 50 * 1024 * 1024

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

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

let colorIdx = -1
const colorMap = new Map<string, string>()

function getColor(cat: string): string {
  if (!colorMap.has(cat)) {
    colorIdx++
    colorMap.set(cat, PALETTE[colorIdx % PALETTE.length])
  }
  return colorMap.get(cat)!
}

const GEMINI_PROMPT = `You are a salon price sheet parser. Extract ALL services from this price sheet exactly as written.

Return a JSON array of service objects. Each object must have:
- "name": string — the service name exactly as written
- "price": number — the price in dollars (e.g. 85.00), or null if not a fixed price
- "category": string — the section/category this service belongs to (e.g. "Shampoo, Sets & Cuts", "Color", "Nail Services")
- "pricingType": one of "fixed" | "addon" | "tiered" | "multi_option"
- "addonAmountCents": number or null — for addon type, the surcharge amount in CENTS (e.g. if it says "add $15", return 1500)
- "pricingTiers": array or null — for tiered pricing like "1-4 $5 ea, 5 or more $4 ea", return [{"minQty":1,"maxQty":4,"unitPriceCents":500},{"minQty":5,"maxQty":null,"unitPriceCents":400}]
- "pricingOptions": array or null — for "choose one" options, return [{"name":"Option A","priceCents":2500}]
- "durationMinutes": 30 (default for all unless specified)

Pricing type rules:
- "fixed": standard service with one price
- "addon": services described as "add $X to service" or "additional $X" or "+$X" — these modify another service, price field should be null, addonAmountCents is the surcharge
- "tiered": quantity-based pricing ("1-4 ea", "5 or more")
- "multi_option": multiple named price points to choose from

Important:
- Extract EVERY service, including add-ons and surcharges
- Do not skip any category or section
- Category names should match the section headers exactly
- Return ONLY the JSON array, no markdown, no explanation`

export async function POST(request: NextRequest) {
  // Reset color state per request
  colorIdx = -1
  colorMap.clear()

  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (facilityUser.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 })

    const rl = await checkRateLimit('parsePdf', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 })
    if (file.size > MAX_PDF_BYTES) {
      return Response.json({ error: 'File too large (max 50MB)' }, { status: 413 })
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      console.error('[parse-pdf] GEMINI_API_KEY is not set')
      return Response.json({ error: 'PDF parsing not configured' }, { status: 500 })
    }

    const buffer = await file.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`
    const body = {
      contents: [{
        parts: [
          { inlineData: { mimeType: 'application/pdf', data: base64 } },
          { text: GEMINI_PROMPT },
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
      console.error('[parse-pdf] Gemini API error:', res.status, errText)
      return Response.json({ error: `Gemini API error ${res.status}` }, { status: 500 })
    }

    const geminiData = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
    }
    const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

    console.log('[parse-pdf] Gemini raw response (first 500):', rawText.slice(0, 500))

    let parsed: unknown[]
    try {
      const cleaned = rawText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
      parsed = JSON.parse(cleaned)
      if (!Array.isArray(parsed)) throw new Error('Response is not a JSON array')
    } catch (parseErr) {
      console.error('[parse-pdf] Failed to parse Gemini response:', parseErr, '\nRaw:', rawText)
      return Response.json({ error: 'Failed to parse price sheet' }, { status: 500 })
    }

    type GeminiService = {
      name?: string
      price?: number | null
      category?: string
      pricingType?: string
      addonAmountCents?: number | null
      pricingTiers?: Array<{ minQty: number; maxQty: number | null; unitPriceCents: number }> | null
      pricingOptions?: Array<{ name: string; priceCents: number }> | null
      durationMinutes?: number
    }

    const rows: ParsedService[] = (parsed as GeminiService[])
      .filter((svc) => svc.name && typeof svc.name === 'string' && svc.name.trim().length > 0)
      .map((svc) => {
        const cat = (svc.category ?? '').trim() || 'Services'
        const pricingType = (['fixed', 'addon', 'tiered', 'multi_option'] as const).includes(
          svc.pricingType as 'fixed' | 'addon' | 'tiered' | 'multi_option'
        )
          ? (svc.pricingType as ParsedService['pricingType'])
          : 'fixed'

        const priceCents =
          pricingType === 'addon'
            ? 0
            : svc.price != null
              ? Math.round(svc.price * 100)
              : 0

        return {
          name: svc.name!.trim(),
          priceCents,
          durationMinutes: svc.durationMinutes ?? 30,
          category: cat,
          color: getColor(cat),
          pricingType,
          addonAmountCents: svc.addonAmountCents ?? null,
          pricingTiers: svc.pricingTiers
            ? svc.pricingTiers.map((t) => ({ ...t, maxQty: t.maxQty ?? 999 }))
            : null,
          pricingOptions: svc.pricingOptions ?? null,
        }
      })

    console.log(`[parse-pdf] Extracted ${rows.length} services across ${colorMap.size} categories`)
    return Response.json({ data: rows })
  } catch (err) {
    console.error('[parse-pdf] error:', err)
    return Response.json({ error: 'Failed to parse PDF' }, { status: 500 })
  }
}
