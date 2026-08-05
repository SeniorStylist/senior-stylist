// Copies the pdf.js worker into /public so it's served SAME-ORIGIN.
//
// Why: the app used to point GlobalWorkerOptions.workerSrc at cdnjs with a
// filename that doesn't exist for pdfjs-dist 5.x (`pdf.worker.min.js` — v5
// ships `.min.mjs` only). On stalling networks the worker handshake has no
// timeout, so getDocument() hung forever ("PDF scan remains idle", 2026-08-03).
// A same-origin worker removes every CDN/cross-origin/blocklist failure mode.
//
// Run manually after upgrading pdfjs-dist, then COMMIT the output —
// nothing copies it at build time (same convention as generate-icons):
//   node scripts/copy-pdf-worker.mjs
//
// NOTE: the worker version must match the pdfjs-dist API version or pdf.js
// throws "The API version does not match the Worker version".

import { copyFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs')
const dest = join(root, 'public/pdf.worker.min.mjs')

copyFileSync(src, dest)
const { size } = statSync(dest)
console.log(`Copied pdf.worker.min.mjs → public/ (${(size / 1024).toFixed(0)} KB). Commit it.`)
