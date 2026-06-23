// Generates the source brand images that `@capacitor/assets` consumes to produce
// the full native icon + splash sets for the iOS and Android projects.
//
// Run order (see the `cap:assets` npm script):
//   1. node scripts/generate-native-assets.mjs   -> writes assets/*.png
//   2. npx @capacitor/assets generate            -> fans them out into android/ + ios/
//
// Uses the project's existing `sharp`. Mirrors the burgundy styling in
// scripts/generate-icons.mjs so native + web/PWA icons stay visually identical.
import sharp from 'sharp'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const logo = path.join(root, 'public/seniorstylistlogo-white.png') // white-on-transparent wordmark
const outDir = path.join(root, 'assets')

const BG = { r: 28, g: 10, b: 18, alpha: 1 } // #1C0A12 dark burgundy
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 }

fs.mkdirSync(outDir, { recursive: true })

// Centered white wordmark over a (size×size) canvas of `background`, sized so the
// logo occupies `coverage` of the canvas width. Returns a sharp buffer promise.
async function compose(size, coverage, background) {
  const logoW = Math.round(size * coverage)
  const resized = await sharp(logo)
    .resize(logoW, null, { fit: 'inside', background: TRANSPARENT })
    .toBuffer()
  return sharp({
    create: { width: size, height: size, channels: 4, background },
  })
    .composite([{ input: resized, gravity: 'center' }])
    .png()
    .toBuffer()
}

async function write(name, buf) {
  await fs.promises.writeFile(path.join(outDir, name), buf)
  console.log(`Generated assets/${name}`)
}

// Square icon (used for iOS + the Android legacy icon): full-bleed burgundy bg.
await write('icon-only.png', await compose(1024, 0.7, BG))
// Android adaptive icon: transparent foreground + solid background. Foreground
// logo is kept inside the ~66% safe zone so the launcher mask never clips it.
await write('icon-foreground.png', await compose(1024, 0.55, TRANSPARENT))
await write(
  'icon-background.png',
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: BG } }).png().toBuffer(),
)
// Splash (light + dark both use the burgundy brand bg with a smaller wordmark).
await write('splash.png', await compose(2732, 0.35, BG))
await write('splash-dark.png', await compose(2732, 0.35, BG))

console.log('Done. Next: npx @capacitor/assets generate')
