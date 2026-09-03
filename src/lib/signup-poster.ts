'use client'

// P57 — the family sign-up QR poster, lifted out of Settings → Family
// Accounts so the New-Facility wizard's Done screen prints the same poster.
// Signage print pattern: a self-contained HTML doc, window.open + print; the
// QR is a data-URL so the page works offline.
//
// The encoded URL comes from NEXT_PUBLIC_APP_URL (inlined at build), NOT
// window.location.origin — a poster printed from a preview deploy used to
// encode a domain families can't reach (the P52 failure mode, one layer up).

export function signupPosterUrl(facilityCode: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || window.location.origin).replace(/\/$/, '')
  return `${base}/family/${encodeURIComponent(facilityCode)}/signup`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function buildSignupPosterHtml(opts: { facilityName: string; url: string; qrDataUrl: string }): string {
  const { facilityName, url, qrDataUrl } = opts
  // qrDataUrl is the ONLY unescaped field — guard it like signage does.
  const safeQr = qrDataUrl.startsWith('data:image/') ? qrDataUrl : ''
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Salon Account Sign-Up — ${esc(facilityName)}</title>
<style>@page{margin:0}body{margin:0;font-family:Georgia,'Times New Roman',serif;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:#1C0A12}
h1{font-size:6vh;margin:0 0 1vh;font-weight:normal}h2{font-size:3.2vh;margin:0 0 4vh;color:#8B2E4A;font-weight:normal}
img{width:38vh;height:38vh}p{font-size:2.4vh;margin:3vh 0 0;max-width:70vw}code{font-size:2vh;color:#57534e}
.brand{position:absolute;bottom:3vh;font-size:1.8vh;color:#8B2E4A}</style></head><body>
<h1>${esc(facilityName)}</h1><h2>Salon Account — book visits, see balances, manage payment</h2>
<img src="${safeQr}" alt="Sign-up QR code">
<p>Scan with your phone camera to create your family account, or visit:<br><code>${esc(url)}</code></p>
<div class="brand">Senior Stylist ♥</div>
<script>setTimeout(function(){window.print()},450)</script></body></html>`
}

/** Opens the poster in a new tab and triggers print. Throws on QR failure. */
export async function openSignupPoster(opts: { facilityName: string; facilityCode: string }): Promise<void> {
  const QRCode = (await import('qrcode')).default
  const url = signupPosterUrl(opts.facilityCode)
  const qrDataUrl = await QRCode.toDataURL(url, { width: 480, margin: 1, color: { dark: '#1C0A12' } })
  const html = buildSignupPosterHtml({ facilityName: opts.facilityName, url, qrDataUrl })
  const w = window.open('', '_blank')
  if (!w) throw new Error('popup blocked')
  w.document.write(html)
  w.document.close()
}
