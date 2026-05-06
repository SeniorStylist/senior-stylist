import sharp from 'sharp'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const input = path.join(__dirname, '../public/Seniorstylistlogo.jpg')
const outDir = path.join(__dirname, '../public')

const BG = { r: 28, g: 10, b: 18, alpha: 1 } // #1C0A12 dark burgundy

async function generate(size, filename) {
  const padding = Math.round(size * 0.12)
  const inner = size - padding * 2
  await sharp(input)
    .resize(inner, inner, { fit: 'contain', background: BG })
    .extend({ top: padding, bottom: padding, left: padding, right: padding, background: BG })
    .png()
    .toFile(path.join(outDir, filename))
  console.log(`Generated ${filename}`)
}

await generate(16, 'favicon-16x16.png')
await generate(32, 'favicon-32x32.png')
await generate(180, 'apple-touch-icon.png')
await generate(192, 'icon-192.png')
await generate(512, 'icon-512.png')
console.log('Done')
