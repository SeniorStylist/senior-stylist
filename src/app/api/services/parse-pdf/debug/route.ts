import { NextRequest } from 'next/server'
import { extractText } from 'unpdf'

export const runtime = 'nodejs'

// Duplicate pre-extraction regexes from main route for standalone debug
const ADDON_GLOBAL = /([A-Za-z][A-Za-z\s,'\-]*?)\s+add\s+\$?(\d+(?:\.\d{1,2})?)\s+to\s+service\s+amount/gi
const TIERED_GLOBAL = /([A-Za-z][A-Za-z\s,'\-]*?)\s+(\d+)\s*-\s*(\d+)\s+\$?(\d+(?:\.\d{1,2})?)\s*ea\.?\s+(\d+)\s+or\s+more\s+\$?(\d+(?:\.\d{1,2})?)\s*ea\.?/gi
const MULTI_OPTION_GLOBAL = /([A-Za-z][A-Za-z\s,'\-]+?)\s+(\d+(?:\.\d{1,2})?)\s*ea\.?\s*-or-\s*(\d+(?:\.\d{1,2})?)\s+for\s+all\s+(\d+)/gi

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 })

    const buffer = await file.arrayBuffer()
    const { text } = await extractText(new Uint8Array(buffer), { mergePages: true })

    // Step 1: Collapse whitespace and strip boilerplate (same as main route)
    const stripped = text
      .replace(/\s+/g, ' ')
      .replace(/Services and Prices Subject to Change[^.]*\./gi, '')
      .replace(/Copyright[^.]*\./gi, '')
      .trim()

    // Step 2: Extract first category name
    const PRICE_SEP = ' Price '
    const firstPricePos = stripped.indexOf(PRICE_SEP)
    const rawFirstCategory = firstPricePos >= 0
      ? stripped.slice(0, firstPricePos).trim()
      : ''

    const cleanFirstCategory = (() => {
      const m = rawFirstCategory.match(/([A-Z][^0-9]+)$/)
      return m ? m[1].trim() : rawFirstCategory
    })()

    let workingBlob = firstPricePos >= 0
      ? stripped.slice(firstPricePos + PRICE_SEP.length)
      : stripped

    // Step 3: Pre-extract special pricing
    const specialKeys: string[] = []
    let counter = 0
    function nextPH(): string {
      let id = '', n = counter++
      do { id = String.fromCharCode(65 + (n % 26)) + id; n = Math.floor(n / 26) - 1 } while (n >= 0)
      return 'SVCPH' + id
    }

    let blobAfterExtraction = workingBlob
    blobAfterExtraction = blobAfterExtraction.replace(TIERED_GLOBAL, (_m) => { const k = nextPH(); specialKeys.push(k); return k + ' 1' })
    blobAfterExtraction = blobAfterExtraction.replace(MULTI_OPTION_GLOBAL, (_m) => { const k = nextPH(); specialKeys.push(k); return k + ' 1' })
    blobAfterExtraction = blobAfterExtraction.replace(ADDON_GLOBAL, (_m) => { const k = nextPH(); specialKeys.push(k); return k + ' 1' })

    // Step 4: Split
    const tokens = blobAfterExtraction.split(/(\d{1,3}(?:\.\d{1,2})?\s*(?:ea\.?)?)/)

    // Also find ALL occurrences of " Price " in stripped text
    const pricePositions: number[] = []
    let searchPos = 0
    while (true) {
      const idx = stripped.indexOf(' Price ', searchPos)
      if (idx === -1) break
      pricePositions.push(idx)
      searchPos = idx + 1
    }

    return Response.json({
      rawTextLength: text.length,
      rawStripped: stripped.slice(0, 3000),
      rawFirstCategory,
      cleanFirstCategory,
      firstPriceSepPos: firstPricePos,
      allPricePositions: pricePositions,
      textAroundFirstPrice: firstPricePos >= 0
        ? stripped.slice(Math.max(0, firstPricePos - 50), firstPricePos + 60)
        : null,
      workingBlob: workingBlob.slice(0, 2000),
      workingBlobAfterExtraction: blobAfterExtraction.slice(0, 2000),
      specialServicesKeys: specialKeys,
      tokenCount: tokens.length,
      firstTokens: tokens.slice(0, 40),
    })
  } catch (err) {
    console.error('parse-pdf debug error:', err)
    return Response.json({ error: 'Failed to parse PDF', detail: String(err) }, { status: 500 })
  }
}
