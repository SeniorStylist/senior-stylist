import { createClient } from '@/lib/supabase/server'
import { createStorageClient } from '@/lib/supabase/storage'
import { db } from '@/db'
import { facilities, residents, qbInvoices } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { getUserFacility } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { fuzzyBestMatch, fuzzyScore, normalizeWords } from '@/lib/fuzzy'
import { NextRequest } from 'next/server'
import crypto from 'crypto'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const MAX_FILE_BYTES = 10 * 1024 * 1024
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

const PAYEE_ADDRESS_FRAGMENT = '2833 smith ave'

type Confidence = 'high' | 'medium' | 'low'
type MatchConfidence = Confidence | 'none'

interface FieldValue<T> {
  value: T | null
  confidence: Confidence
}

interface ResidentLine {
  rawName: string
  amountCents: number
  serviceCategory: string | null
}

interface InvoiceLine {
  ref: string | null
  invoiceDate: string | null
  amountCents: number
  confidence: Confidence
}

interface GeminiResult {
  documentType: string
  checkNum: string | null
  checkDate: string | null
  amount: number | null
  payerName: string | null
  payerAddress: string | null
  invoiceRef: string | null
  invoiceDate: string | null
  memo: string | null
  residentLines: ResidentLine[]
  invoiceLines: InvoiceLine[]
  overallConfidence: Confidence
  unresolvableReason: string | null
  fieldConfidence?: Record<string, Confidence>
}

const PROMPT = `You are an OCR assistant reading a paper check or remittance document from a senior-living facility. Classify the document and extract every readable field.

Return ONLY a JSON object with this EXACT shape — no markdown, no prose:
{
  "documentType": "IP_PERSONAL_CHECK" | "RFMS_PETTY_CASH_BREAKDOWN" | "FACILITY_CHECK" | "REMITTANCE_SLIP" | "UNREADABLE",
  "checkNum": string | null,
  "checkDate": "YYYY-MM-DD" | null,
  "amount": number | null,
  "payerName": string | null,
  "payerAddress": string | null,
  "invoiceRef": string | null,
  "invoiceDate": "YYYY-MM-DD" | null,
  "memo": string | null,
  "residentLines": [
    { "rawName": string, "amountCents": number, "serviceCategory": string | null }
  ],
  "invoiceLines": [
    { "ref": string | null, "invoiceDate": "YYYY-MM-DD" | null, "amountCents": number, "confidence": "high" | "medium" | "low" }
  ],
  "fieldConfidence": {
    "checkNum": "high" | "medium" | "low",
    "checkDate": "high" | "medium" | "low",
    "amount": "high" | "medium" | "low",
    "payerName": "high" | "medium" | "low",
    "invoiceRef": "high" | "medium" | "low"
  },
  "overallConfidence": "high" | "medium" | "low",
  "unresolvableReason": string | null
}

Classification rules:
- IP_PERSONAL_CHECK — single-resident personal check. One payer. No per-resident breakdown.
- RFMS_PETTY_CASH_BREAKDOWN — facility petty-cash check with an attached list of residents and amounts ("BEAUTY SHOP / BARBER" or similar service column).
- FACILITY_CHECK — single facility check with no per-resident breakdown (just a lump sum).
- REMITTANCE_SLIP — a printed remittance slip (no physical check) listing an invoice reference and amount.
- UNREADABLE — the image is blurry, upside-down, or otherwise not a check. Set all extracted fields to null and put a reason in unresolvableReason.

Extraction rules:
- "amount" is the TOTAL dollar amount written on the check (not cents) — a decimal number like 1234.56, or null.
- "residentLines[].amountCents" is an INTEGER in cents (e.g. $12.50 → 1250).
- Resident names: extract EXACTLY as written (last-comma-first or first-last). If handwriting is unclear, make your best attempt; never invent.
- "payerAddress" is the address on the CHECK ITSELF (top-left of most checks), not the "Pay to" address. Leave null if unreadable.
- "invoiceRef" is any invoice number / reference in the memo line or attached remittance stub. Format varies — preserve verbatim.
- Service category examples: "BEAUTY SHOP", "BARBER", "SALON", "SERVICES" — null when not shown.
- "invoiceLines": For REMITTANCE_SLIP documents ONLY — extract each line showing an invoice reference + date + amount. Each entry is one remittance invoice line. Return [] for all other document types. "amountCents" is an INTEGER in cents.
- Check number location: For RFMS_PETTY_CASH_BREAKDOWN and REMITTANCE_SLIP, the check number may appear in the top-left corner (e.g. "006847"), as a field labeled "Check Number" / "Check #" / "Check No.", or in a footer row near "CHECK AMT" / "CHECK DATE" labels. Scan the ENTIRE document for these patterns, not just the top-right corner. For RFMS_PETTY_CASH_BREAKDOWN the check number is typically in the top-right corner.
- fieldConfidence: "high" = clearly legible; "medium" = probable but imperfect; "low" = guess.
- overallConfidence: "high" = you are confident in every important field; "medium" = some low-confidence fields but usable; "low" = many fields unreadable.

Return ONLY the JSON object.`

function normalizeMoneyToCents(value: unknown): number | null {
  if (value == null) return null
  const n = typeof value === 'number' ? value : parseFloat(String(value))
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

function confidenceFromScore(score: number): MatchConfidence {
  if (score >= 0.85) return 'high'
  if (score >= 0.7) return 'medium'
  if (score > 0) return 'low'
  return 'none'
}

function fieldOf<T>(value: T | null, conf: Confidence | undefined, fallback: Confidence = 'medium'): FieldValue<T> {
  return { value, confidence: conf ?? fallback }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const isMaster =
      !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
      user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

    const facilityUser = await getUserFacility(user.id)
    if (!isMaster && (!facilityUser || facilityUser.role !== 'admin')) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rl = await checkRateLimit('checkScan', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      console.error('[scan-check] GEMINI_API_KEY is not set')
      return Response.json({ error: 'OCR not configured' }, { status: 500 })
    }

    const formData = await request.formData()
    const facilityId = formData.get('facilityId')
    const file = formData.get('image')

    if (typeof facilityId !== 'string' || !facilityId) {
      return Response.json({ error: 'Missing facilityId' }, { status: 400 })
    }

    if (!isMaster && facilityUser?.facilityId !== facilityId) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!(file instanceof File)) {
      return Response.json({ error: 'Missing image' }, { status: 400 })
    }
    if (file.size > MAX_FILE_BYTES) {
      return Response.json({ error: 'Image too large (max 10MB)' }, { status: 413 })
    }
    if (!ALLOWED_MIME.has(file.type)) {
      return Response.json({ error: `Unsupported image type: ${file.type}` }, { status: 415 })
    }

    const ext = MIME_EXT[file.type] ?? 'bin'
    const storagePath = `${facilityId}/${Date.now()}-${crypto.randomUUID()}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const storage = createStorageClient()
    const uploadRes = await storage.storage.from('check-images').upload(storagePath, buffer, {
      contentType: file.type,
      upsert: false,
    })
    if (uploadRes.error) {
      console.error('[scan-check] upload error:', uploadRes.error)
      return Response.json({ error: 'Storage upload failed' }, { status: 500 })
    }

    const signedRes = await storage.storage.from('check-images').createSignedUrl(storagePath, 3600)
    const imageUrl = signedRes.data?.signedUrl ?? null

    // ─── Gemini call ───
    const base64 = buffer.toString('base64')
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`
    const body = {
      contents: [
        {
          parts: [
            { inlineData: { mimeType: file.type, data: base64 } },
            { text: PROMPT },
          ],
        },
      ],
    }

    let rawText = ''
    try {
      const res = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errText = await res.text()
        console.error('[scan-check] Gemini error:', res.status, errText)
        return Response.json(
          {
            data: {
              imageUrl,
              storagePath,
              unresolvable: true,
              unresolvableReason: `OCR service error (${res.status})`,
              documentType: 'UNREADABLE',
              extracted: null,
              facilityMatch: { facilityId: null, name: null, facilityCode: null, confidence: 'none' },
              residentMatches: [],
              invoiceMatch: { confidence: 'none', matchedInvoiceIds: [], totalOpenCents: 0, remainingCents: 0 },
              rawOcrJson: { error: errText.slice(0, 500) },
              overallConfidence: 'low',
              invoiceLines: [],
            },
          },
          { status: 200 },
        )
      }
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[]
      }
      rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    } catch (err) {
      console.error('[scan-check] Gemini fetch failed:', err)
      return Response.json(
        {
          data: {
            imageUrl,
            storagePath,
            unresolvable: true,
            unresolvableReason: 'OCR service unavailable',
            documentType: 'UNREADABLE',
            extracted: null,
            facilityMatch: { facilityId: null, name: null, facilityCode: null, confidence: 'none' },
            residentMatches: [],
            invoiceMatch: { confidence: 'none', matchedInvoiceIds: [], totalOpenCents: 0, remainingCents: 0 },
            rawOcrJson: {},
            overallConfidence: 'low',
            invoiceLines: [],
          },
        },
        { status: 200 },
      )
    }

    let parsed: GeminiResult
    try {
      const cleaned = rawText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
      parsed = JSON.parse(cleaned) as GeminiResult
    } catch (parseErr) {
      console.error('[scan-check] JSON parse error:', parseErr, '\nRaw:', rawText.slice(0, 500))
      return Response.json(
        {
          data: {
            imageUrl,
            storagePath,
            unresolvable: true,
            unresolvableReason: 'OCR returned malformed JSON',
            documentType: 'UNREADABLE',
            extracted: null,
            facilityMatch: { facilityId: null, name: null, facilityCode: null, confidence: 'none' },
            residentMatches: [],
            invoiceMatch: { confidence: 'none', matchedInvoiceIds: [], totalOpenCents: 0, remainingCents: 0 },
            rawOcrJson: { rawText: rawText.slice(0, 1000) },
            overallConfidence: 'low',
          },
        },
        { status: 200 },
      )
    }

    if (parsed.documentType === 'UNREADABLE') {
      return Response.json({
        data: {
          imageUrl,
          storagePath,
          unresolvable: true,
          unresolvableReason: parsed.unresolvableReason ?? 'Document could not be read',
          documentType: 'UNREADABLE',
          extracted: null,
          facilityMatch: { facilityId: null, name: null, facilityCode: null, confidence: 'none' },
          residentMatches: [],
          invoiceMatch: { confidence: 'none', matchedInvoiceIds: [], totalOpenCents: 0, remainingCents: 0 },
          rawOcrJson: parsed as unknown as Record<string, unknown>,
          overallConfidence: parsed.overallConfidence ?? 'low',
          invoiceLines: [],
        },
      })
    }

    // ─── Facility matching ───
    const activeFacilities = await db.query.facilities.findMany({
      where: eq(facilities.active, true),
      columns: { id: true, name: true, facilityCode: true, address: true },
    })

    let matchedFacility:
      | { id: string; name: string; facilityCode: string | null }
      | null = null
    let facilityConfidence: MatchConfidence = 'none'

    const payerName = (parsed.payerName ?? '').trim()
    const payerAddr = (parsed.payerAddress ?? '').trim().toLowerCase()
    const invoiceRef = (parsed.invoiceRef ?? '').trim()
    const isOurAddress = payerAddr.includes(PAYEE_ADDRESS_FRAGMENT)

    // 1. facility_code from invoiceRef (most reliable — run first regardless of payer address)
    if (!matchedFacility && invoiceRef) {
      const codeMatch = invoiceRef.match(/\bF\d{2,4}\b/i)
      if (codeMatch) {
        const code = codeMatch[0].toUpperCase()
        const hit = activeFacilities.find(
          (f) => (f.facilityCode ?? '').toUpperCase() === code,
        )
        if (hit) {
          matchedFacility = { id: hit.id, name: hit.name, facilityCode: hit.facilityCode }
          facilityConfidence = 'high'
        }
      }
    }

    // Name-based matching is skipped when the payer address is our own mailing address
    // (that means the check was sent TO us, so the payer field is not a facility name)
    if (!matchedFacility && !isOurAddress) {
      const namedList = activeFacilities
        .filter((f) => f.name)
        .map((f) => ({ id: f.id, name: f.name as string, facilityCode: f.facilityCode }))

      // 2. exact name (case-insensitive)
      if (payerName) {
        const exactName = namedList.find(
          (f) => f.name.toLowerCase() === payerName.toLowerCase(),
        )
        if (exactName) {
          matchedFacility = { id: exactName.id, name: exactName.name, facilityCode: exactName.facilityCode }
          facilityConfidence = 'high'
        }
      }

      // 3. fuzzy match on name
      if (!matchedFacility && payerName) {
        const best = fuzzyBestMatch(namedList, payerName, 0.7)
        if (best) {
          matchedFacility = { id: best.id, name: best.name, facilityCode: best.facilityCode }
          const score = fuzzyScore(payerName, best.name)
          facilityConfidence = score >= 0.85 ? 'high' : 'medium'
        }
      }

      // 4. word-fragment pass
      // Matches on ≥2 shared words OR any single word ≥6 chars (unique proper nouns
      // like "Layhill", "Brightview" that are unambiguous even alone).
      if (!matchedFacility && payerName) {
        const payerWords = normalizeWords(payerName)
        let bestHit: typeof namedList[number] | null = null
        let bestOverlap = 1 // require strict > 1 for short-word multi-match
        for (const f of namedList) {
          const fWords = normalizeWords(f.name)
          const sharedWords = payerWords.filter((w) => fWords.includes(w))
          const overlap = sharedWords.length
          const hasLongShared = sharedWords.some((w) => w.length >= 6)
          if (overlap > bestOverlap || (overlap === 1 && hasLongShared && !bestHit)) {
            bestOverlap = overlap
            bestHit = f
          }
        }
        if (bestHit) {
          matchedFacility = { id: bestHit.id, name: bestHit.name, facilityCode: bestHit.facilityCode }
          facilityConfidence = 'medium'
        }
      }
    }

    // 5. payer-address substring (skip our own payee address)
    if (!matchedFacility && payerAddr && !isOurAddress) {
      const hit = activeFacilities.find((f) => {
        const fa = (f.address ?? '').toLowerCase()
        return fa.length > 5 && (fa.includes(payerAddr) || payerAddr.includes(fa))
      })
      if (hit) {
        matchedFacility = { id: hit.id, name: hit.name, facilityCode: hit.facilityCode }
        facilityConfidence = 'medium'
      }
    }

    // ─── Resident matching ───
    // Always map resident lines — even when facility is unknown, return raws so
    // the confirmation UI can show them and let the user match manually.
    interface ResidentMatch {
      rawName: string
      amountCents: number
      serviceCategory: string | null
      residentId: string | null
      residentName: string | null
      matchConfidence: MatchConfidence
    }
    const residentMatches: ResidentMatch[] = []
    const rawLines = parsed.residentLines ?? []
    if (rawLines.length) {
      const residentList = matchedFacility
        ? await db.query.residents.findMany({
            where: and(eq(residents.facilityId, matchedFacility.id), eq(residents.active, true)),
            columns: { id: true, name: true, roomNumber: true },
          })
        : []
      for (const line of rawLines) {
        const rawName = (line.rawName ?? '').trim()
        if (!rawName) continue
        const best = residentList.length ? fuzzyBestMatch(residentList, rawName, 0.5) : null
        const score = best ? fuzzyScore(rawName, best.name) : 0
        const confidence: MatchConfidence = best ? confidenceFromScore(score) : 'none'
        residentMatches.push({
          rawName,
          amountCents: Number.isFinite(line.amountCents) ? Math.round(line.amountCents) : 0,
          serviceCategory: line.serviceCategory ?? null,
          residentId: best?.id ?? null,
          residentName: best?.name ?? null,
          matchConfidence: confidence,
        })
      }
    }

    // ─── Invoice matching ───
    const amountCents = normalizeMoneyToCents(parsed.amount)
    let invoiceMatch: {
      confidence: 'high' | 'partial' | 'none'
      matchedInvoiceIds: string[]
      totalOpenCents: number
      remainingCents: number
    } = { confidence: 'none', matchedInvoiceIds: [], totalOpenCents: 0, remainingCents: 0 }

    if (matchedFacility && amountCents != null) {
      const openInvoices = await db.query.qbInvoices.findMany({
        where: and(
          eq(qbInvoices.facilityId, matchedFacility.id),
          eq(qbInvoices.status, 'open'),
        ),
        columns: { id: true, openBalanceCents: true, invoiceNum: true },
      })
      const exact = openInvoices.find((inv) => inv.openBalanceCents === amountCents)
      const totalOpen = openInvoices.reduce((s, i) => s + (i.openBalanceCents ?? 0), 0)
      if (exact) {
        invoiceMatch = {
          confidence: 'high',
          matchedInvoiceIds: [exact.id],
          totalOpenCents: totalOpen,
          remainingCents: 0,
        }
      } else if (totalOpen > amountCents) {
        invoiceMatch = {
          confidence: 'partial',
          matchedInvoiceIds: [],
          totalOpenCents: totalOpen,
          remainingCents: totalOpen - amountCents,
        }
      }
    }

    const fc = parsed.fieldConfidence ?? {}
    const extracted = {
      checkNum: fieldOf(parsed.checkNum ?? null, fc.checkNum),
      checkDate: fieldOf(parsed.checkDate ?? null, fc.checkDate),
      amountCents: fieldOf(amountCents, fc.amount),
      payerName: fieldOf(parsed.payerName ?? null, fc.payerName),
      payerAddress: fieldOf(parsed.payerAddress ?? null, 'medium'),
      invoiceRef: fieldOf(parsed.invoiceRef ?? null, fc.invoiceRef),
      invoiceDate: fieldOf(parsed.invoiceDate ?? null, 'medium'),
      memo: fieldOf(parsed.memo ?? null, 'medium'),
    }

    return Response.json({
      data: {
        imageUrl,
        storagePath,
        unresolvable: false,
        unresolvableReason: null,
        documentType: parsed.documentType,
        extracted,
        facilityMatch: matchedFacility
          ? {
              facilityId: matchedFacility.id,
              name: matchedFacility.name,
              facilityCode: matchedFacility.facilityCode,
              confidence: facilityConfidence,
            }
          : { facilityId: null, name: null, facilityCode: null, confidence: 'none' },
        residentMatches,
        invoiceMatch,
        rawOcrJson: parsed as unknown as Record<string, unknown>,
        overallConfidence: parsed.overallConfidence ?? 'medium',
        invoiceLines: (parsed.invoiceLines ?? []).map((l) => ({
          ref: l.ref ?? null,
          invoiceDate: l.invoiceDate ?? null,
          amountCents: Number.isFinite(l.amountCents) ? Math.round(l.amountCents) : 0,
          confidence: l.confidence ?? 'medium',
        })),
      },
    })
  } catch (err) {
    console.error('[scan-check] unexpected error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
