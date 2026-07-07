// Rasterize public/favicon.svg into the PWA icon set (ADR-0031 follow-up).
//
// The favicon is a transparent 64×64 vector; installable PWAs also need raster PNGs at fixed
// sizes, a maskable variant (opaque background + claw kept inside the ~80% safe zone so Android's
// adaptive-icon crop never clips it), and an iOS apple-touch-icon (iOS ignores transparency, so we
// bake the brand background in). Re-run with `npm run gen:icons` whenever favicon.svg changes.
//
// Uses `sharp` (devDependency). No ImageMagick/rsvg-convert was available in the build env.

import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = join(root, 'public')

// Brand background (matches manifest.background_color / the face fill in favicon.svg). Opaque.
const BG = { r: 0xf8, g: 0xf2, b: 0xe6, alpha: 1 }

const rawSvg = readFileSync(join(publicDir, 'favicon.svg'), 'utf8')

// librsvg (sharp's SVG backend) rasterizes at the SVG's intrinsic size before any resize; favicon.svg
// declares only a viewBox, so give it explicit pixel dimensions to render crisply at the target size.
const sizedSvg = (px) => Buffer.from(rawSvg.replace('<svg ', `<svg width="${px}" height="${px}" `))

// A transparent PNG of the claw at the given size.
const claw = (px) => sharp(sizedSvg(px)).png()

// The claw centered on an opaque brand-colored square, `fraction` of the canvas wide.
async function onBackground(size, fraction) {
  const inner = Math.round(size * fraction)
  const clawPng = await claw(inner).toBuffer()
  return sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: clawPng, gravity: 'center' }])
    .flatten({ background: BG }) // guarantee a fully opaque icon
    .png()
}

const out = (name) => join(publicDir, name)

await claw(192).toFile(out('pwa-192x192.png')) // purpose: any
await claw(512).toFile(out('pwa-512x512.png')) // purpose: any
await (await onBackground(512, 0.8)).toFile(out('pwa-maskable-512x512.png')) // purpose: maskable
await (await onBackground(180, 0.86)).toFile(out('apple-touch-icon.png')) // iOS home screen

console.log('Wrote PWA icons to public/:')
for (const f of [
  'pwa-192x192.png',
  'pwa-512x512.png',
  'pwa-maskable-512x512.png',
  'apple-touch-icon.png',
]) {
  const { width, height } = await sharp(out(f)).metadata()
  console.log(`  ${f} — ${width}×${height}, ${statSync(out(f)).size} bytes`)
}
