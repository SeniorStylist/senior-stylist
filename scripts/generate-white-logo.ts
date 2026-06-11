/**
 * Generate `public/seniorstylistlogo-white.png` — a white-on-transparent version
 * of the burgundy-on-white `seniorstylistlogo.jpg`, for use on dark/burgundy
 * backgrounds in EMAIL (where the CSS `filter: brightness(0) invert(1)` trick the
 * app sidebar uses is stripped by mail clients, so the white logo must be a real
 * raster asset).
 *
 * Run: npx tsx scripts/generate-white-logo.ts
 * Requires: sharp. Commit the generated PNG — Vercel does not run this at build.
 */
import sharp from 'sharp'

const SRC = 'public/seniorstylistlogo.jpg'
const OUT = 'public/seniorstylistlogo-white.png'

async function main() {
  const { data, info } = await sharp(SRC)
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const W = info.width
  const H = info.height
  const C = info.channels // 3
  const out = Buffer.alloc(W * H * 4)

  for (let p = 0, q = 0; p < data.length; p += C, q += 4) {
    const lum = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]
    // white bg (high lum) → alpha 0; burgundy/gray foreground (low lum) → solid.
    // −12 floor kills near-white JPG margin noise; ×1.7 gain solidifies the fill.
    let a = Math.round((255 - lum - 12) * 1.7)
    if (a < 0) a = 0
    if (a > 255) a = 255
    out[q] = 255
    out[q + 1] = 255
    out[q + 2] = 255
    out[q + 3] = a
  }

  await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toFile(OUT)
  console.log(`Wrote ${OUT} (${W}x${H})`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
