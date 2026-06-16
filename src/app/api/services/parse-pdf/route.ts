import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { NextRequest } from 'next/server'

const MAX_PDF_BYTES = 50 * 1024 * 1024
const MAX_GRID_CHARS = 400_000 // ~ tens of thousands of spreadsheet rows

// Gemini reads PDFs and images natively via inlineData. Price sheets often only
// exist as a screenshot/photo, so accept those too — not just PDF.
const FILE_MIME_ALLOW = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
])
const EXT_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
}
function resolveFileMime(file: File): string | null {
  if (file.type && FILE_MIME_ALLOW.has(file.type)) return file.type
  // Some browsers omit file.type (esp. for HEIC) — fall back to the extension.
  const ext = file.name.split('.').pop()?.toLowerCase()
  return (ext && EXT_TO_MIME[ext]) || null
}

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

const GEMINI_PROMPT = `You are a price sheet parser for a salon / senior-living facility. Extract every real, purchasable service or item from this price sheet exactly as written.

IGNORE everything that is not an actual priced service or item. Do NOT create a row for:
- section or category headers (e.g. "Resident Services", "Food & Beverage", "Beauty Salon/Barber Shop Price List")
- titles, facility names, effective dates, page markers ("Continued Next Page")
- policy / disclaimer / explanatory prose and footnotes (sentences, paragraphs, "* Hook up of one TV...", "This price list is not intended...")
- blank rows or rows that are only a label with no price
A real service/item has a NAME and almost always a PRICE (or a clearly stated add-on/surcharge). If a row has neither a price nor an add-on amount, do not include it. Use the surrounding section header as the row's "category".

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
- "tiered": PER-UNIT or quantity-based pricing. Use "tiered" in BOTH of these cases:
  - A flat per-unit price written with "each" / "ea" / "ea." / "per" and NO alternative price (e.g. "Nail polish $8 ea", "PA pack 8 ea.", "$5 each"). Emit a SINGLE tier: pricingTiers [{"minQty":1,"maxQty":999,"unitPriceCents":<price in cents>}], price null. This lets staff enter a quantity at booking so the total becomes price × quantity.
  - Quantity breaks ("1-4 $5 ea, 5 or more $4 ea") → one tier per break.
- "multi_option": multiple named price points to choose from. Use this whenever ONE row lists more than one DISTINCT price:
  - "50/half  75/full" or "$50 half head / $75 full head" → pricingOptions [{"name":"Half","priceCents":5000},{"name":"Full","priceCents":7500}], price null
  - "10 ea. -or- all 3 for 25" → pricingOptions [{"name":"Each","priceCents":1000},{"name":"All 3","priceCents":2500}], price null (two distinct prices → options, NOT per-unit tiered)
- A price written with a trailing "+", "and up", or "start at" (e.g. "80+", "Braids (start at) 26") is still pricingType "fixed" — use the number as the price; keep any "(start at)"/"and up" wording in the name.

Important:
- Extract EVERY service, including add-ons and surcharges
- Treat a row whose name ends in "(add)", "(add to a service)", or "add" as an addon — set addonAmountCents to the listed amount in cents and price null
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

    // The parse is facility-agnostic (it just reads a price sheet). The master
    // admin uses it for the cross-facility bulk price-sheet tool, so allow them
    // through even without an admin facility membership.
    const isMaster = !!user.email && user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    if (!isMaster) {
      const facilityUser = await getUserFacility(user.id)
      if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
      if (facilityUser.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rl = await checkRateLimit('parsePdf', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    // Spreadsheets (xlsx/xls/csv) are sent as a tab-separated cell grid — Gemini
    // doesn't parse xlsx binary, but it reads the grid text and extracts services
    // intelligently (ignoring headers/prose), exactly like it does for PDFs.
    const gridText = formData.get('gridText') as string | null
    if (!file && !gridText) return Response.json({ error: 'No file provided' }, { status: 400 })
    if (file && file.size > MAX_PDF_BYTES) {
      return Response.json({ error: 'File too large (max 50MB)' }, { status: 413 })
    }
    if (gridText && gridText.length > MAX_GRID_CHARS) {
      return Response.json({ error: 'Spreadsheet too large to parse' }, { status: 413 })
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      console.error('[parse-pdf] GEMINI_API_KEY is not set')
      return Response.json({ error: 'Price sheet parsing not configured' }, { status: 500 })
    }

    let parts: Array<Record<string, unknown>>
    if (file) {
      const mimeType = resolveFileMime(file)
      if (!mimeType) {
        return Response.json({ error: 'Unsupported file type. Upload a PDF or an image (PNG/JPG/HEIC).' }, { status: 415 })
      }
      const buffer = await file.arrayBuffer()
      const base64 = Buffer.from(buffer).toString('base64')
      parts = [
        { inlineData: { mimeType, data: base64 } },
        { text: GEMINI_PROMPT },
      ]
    } else {
      parts = [
        { text: `${GEMINI_PROMPT}\n\nThe following is the full cell grid of a spreadsheet price sheet (tab-separated cells, one row per line). Extract the services from it:\n\n${gridText}` },
      ]
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`
    const body = {
      contents: [{ parts }],
      // temperature 0 → repeatable extraction; JSON mode → guaranteed parseable output.
      // thinkingBudget 0 → disable Gemini 2.5 "thinking", which otherwise burns tens
      // of seconds over-reasoning messy sheets and times the function out. Structured
      // extraction from a clean text grid / typed price sheet doesn't need it.
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      },
    }

    // Abort before maxDuration so a slow Gemini call returns clean JSON, not an
    // HTML platform-timeout page (which would crash the client's res.json()).
    const controller = new AbortController()
    const abortTimer = setTimeout(() => controller.abort(), 50_000)
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (fetchErr) {
      if ((fetchErr as Error).name === 'AbortError') {
        return Response.json({ error: 'The price sheet parser timed out. Please try again.' }, { status: 504 })
      }
      throw fetchErr
    } finally {
      clearTimeout(abortTimer)
    }

    if (!res.ok) {
      const errText = await res.text()
      console.error('[parse-pdf] Gemini API error:', res.status, errText)
      return Response.json({ error: `Gemini API error ${res.status}` }, { status: 500 })
    }

    const geminiData = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
    }
    const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

    let parsed: unknown[]
    try {
      const cleaned = rawText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
      const json = JSON.parse(cleaned)
      if (Array.isArray(json)) {
        parsed = json
      } else if (json && typeof json === 'object') {
        // JSON mode without a schema sometimes wraps the array, e.g. {"services":[...]}.
        // Pull out the first array-valued property rather than failing the whole parse.
        const arr = Object.values(json as Record<string, unknown>).find((v) => Array.isArray(v))
        if (!arr) throw new Error('Response object contained no services array')
        parsed = arr as unknown[]
      } else {
        throw new Error('Response is not a JSON array')
      }
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

    return Response.json({ data: rows })
  } catch (err) {
    console.error('[parse-pdf] error:', err)
    return Response.json({ error: 'Failed to parse PDF' }, { status: 500 })
  }
}
