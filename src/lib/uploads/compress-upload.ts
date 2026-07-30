// Client-side upload preparation for scan/photo surfaces.
//
// Why: Vercel rejects any request body over ~4.5 MB at the platform edge —
// BEFORE our route handlers run — with a non-JSON error page. Phone-camera
// JPEGs (3–12 MB) and scanner PDFs (1–10 MB/page) blew straight past that,
// and the client rendered the resulting res.json() throw as "Network error"
// (bookkeeper report 2026-07-30). Server-side size checks can't fix this;
// the payload has to shrink before it leaves the browser.
//
// All helpers are defensive: any failure returns the original file(s) so an
// odd browser/codec never blocks an upload that might have succeeded anyway.

/** Files at or under this size are sent untouched. */
const PASS_THROUGH_BYTES = 1.2 * 1024 * 1024
/** Longest edge after downscale — plenty for handwriting OCR. */
const MAX_EDGE_PX = 2000
const JPEG_QUALITY = 0.8
/** Per-request byte budget — headroom under Vercel's ~4.5 MB body cap. */
export const UPLOAD_CHUNK_BYTE_BUDGET = 3.5 * 1024 * 1024

function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
}

async function drawToBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file)
  } catch {
    // Older Safari / unusual codecs — fall back to an <img> decode
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('image decode failed'))
        img.src = url
      })
      return img
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

/**
 * Downscale + re-encode an image for upload (longest edge ~2000px, JPEG 0.8).
 * Small files pass through untouched; any failure returns the original file.
 */
export async function compressImageForUpload(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) return file
  if (file.size <= PASS_THROUGH_BYTES) return file
  try {
    const bitmap = await drawToBitmap(file)
    const width = 'naturalWidth' in bitmap ? bitmap.naturalWidth : bitmap.width
    const height = 'naturalHeight' in bitmap ? bitmap.naturalHeight : bitmap.height
    if (!width || !height) return file
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(width, height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    if ('close' in bitmap) bitmap.close()
    const blob = await canvasToJpegBlob(canvas)
    if (!blob || blob.size >= file.size) return file
    const name = file.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg' })
  } catch (err) {
    console.error('[compressImageForUpload] falling back to original:', err)
    return file
  }
}

/**
 * Rasterize EVERY page of a PDF into upload-ready JPEG files (~144 dpi).
 * Each page becomes its own sheet image — multi-page log-sheet PDFs used to
 * upload as one oversized file (and only page 1 was ever previewed).
 * Returns the original file untouched if rendering fails.
 */
export async function pdfToPageImages(file: File): Promise<File[]> {
  try {
    const pdfjsLib = await import('pdfjs-dist')
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`
    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
    const baseName = file.name.replace(/\.pdf$/i, '')
    const pages: File[] = []
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p)
      const viewport = page.getViewport({ scale: 2 })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas 2d context unavailable')
      await page.render({ canvasContext: ctx, canvas, viewport }).promise
      const blob = await canvasToJpegBlob(canvas)
      if (!blob) throw new Error('toBlob returned null')
      pages.push(new File([blob], `${baseName}-p${p}.jpg`, { type: 'image/jpeg' }))
    }
    return pages.length > 0 ? pages : [file]
  } catch (err) {
    console.error('[pdfToPageImages] falling back to original PDF:', err)
    return [file]
  }
}

/**
 * Pack files into per-request chunks by BYTE budget (not a fixed count) so no
 * single POST exceeds the platform body cap. Always at least one file per
 * chunk; `maxCount` keeps per-request Gemini time bounded.
 */
export function packFilesByBudget(
  files: File[],
  maxBytes: number = UPLOAD_CHUNK_BYTE_BUDGET,
  maxCount = 3,
): File[][] {
  const chunks: File[][] = []
  let current: File[] = []
  let currentBytes = 0
  for (const f of files) {
    if (current.length > 0 && (currentBytes + f.size > maxBytes || current.length >= maxCount)) {
      chunks.push(current)
      current = []
      currentBytes = 0
    }
    current.push(f)
    currentBytes += f.size
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

/**
 * Parse a fetch Response that SHOULD be JSON but may be a platform error page
 * (413/504 HTML). Never throws; `json` is {} when the body wasn't JSON.
 */
export async function readJsonSafe(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text().catch(() => '')
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return {}
  }
}
