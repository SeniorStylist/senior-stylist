'use client'

import { useEffect, useState } from 'react'
import { Printer } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { useToast } from '@/components/ui/toast'
import { isNativeApp } from '@/lib/detect-device'

type Category = 'General' | 'Holiday'

interface Template {
  id: string
  name: string
  category: Category
  accent: string
  title: string
  subtitle: string
  dateLine: string
  body: string
  footer: string
}

const ACCENTS = [
  { name: 'Burgundy', v: '#8B2E4A' },
  { name: 'Emerald', v: '#0F766E' },
  { name: 'Navy', v: '#1E3A5F' },
  { name: 'Gold', v: '#B7791F' },
  { name: 'Crimson', v: '#B91C1C' },
  { name: 'Plum', v: '#6B21A8' },
]

const TEMPLATES: Template[] = [
  { id: 'salon-day', name: 'Salon Day', category: 'General', accent: '#8B2E4A', title: 'Salon Day!', subtitle: 'Hair • Nails • Styling', dateLine: 'Every Tuesday', body: 'Walk-ins welcome\nTreat yourself today', footer: '' },
  { id: 'now-open', name: 'Now Open', category: 'General', accent: '#0F766E', title: 'The Salon is Open', subtitle: 'Walk-ins Welcome', dateLine: '', body: 'Come on in and relax', footer: '' },
  { id: 'price-list', name: 'Price List', category: 'General', accent: '#1E3A5F', title: 'Salon Services', subtitle: '', dateLine: '', body: 'Haircut — $25\nShampoo & Set — $35\nManicure — $20\nStyling — $30', footer: 'Ask at the front desk to book' },
  { id: 'welcome', name: 'Welcome', category: 'General', accent: '#6B21A8', title: 'Welcome!', subtitle: '', dateLine: '', body: 'We’re so glad you’re here.', footer: '' },
  { id: 'holiday-hours', name: 'Holiday Hours', category: 'Holiday', accent: '#B91C1C', title: 'Holiday Hours', subtitle: '', dateLine: '', body: 'Closed Dec 24–25\nOpen Dec 26 · 9am–4pm', footer: 'Happy Holidays from all of us' },
  { id: 'closed-holiday', name: 'Closed for Holiday', category: 'Holiday', accent: '#B7791F', title: 'Closed Today', subtitle: 'Happy Holidays!', dateLine: '', body: 'The salon will reopen tomorrow.', footer: '' },
  { id: 'happy-holidays', name: 'Happy Holidays', category: 'Holiday', accent: '#0F766E', title: 'Happy Holidays!', subtitle: 'From the salon team', dateLine: '', body: 'Wishing you joy this season', footer: '' },
]

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

interface SignConfig {
  facilityName: string
  facilityPhone: string | null
  showFacility: boolean
  accent: string
  title: string
  subtitle: string
  dateLine: string
  body: string
  footer: string
}

function buildSignHtml(cfg: SignConfig): string {
  const e = escHtml
  const lines = cfg.body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `<p class="line">${e(l)}</p>`)
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&display=swap');
@page { size: portrait; margin: 0; }
* { margin:0; padding:0; box-sizing:border-box; }
html,body { height:100%; }
body { font-family:'DM Sans',system-ui,sans-serif; color:#1c1917; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
.page { height:100vh; width:100%; display:flex; flex-direction:column; }
.bar { height:2.4vh; background:${cfg.accent}; }
.inner { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:6vh 8vw; gap:2.4vh; border:0.8vh solid ${cfg.accent}; border-top:0; }
.facility { font-size:3.2vh; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; color:${cfg.accent}; }
.title { font-family:'DM Serif Display',serif; font-size:11vh; line-height:1.02; }
.subtitle { font-size:4.2vh; color:#57534e; }
.dateline { font-size:4.8vh; font-weight:700; background:${cfg.accent}; color:#fff; padding:1.2vh 4vw; border-radius:999px; }
.lines { display:flex; flex-direction:column; gap:1.2vh; margin-top:1vh; }
.line { font-size:3.6vh; color:#292524; }
.note { font-size:3vh; color:#57534e; margin-top:1vh; }
.footer { font-size:2vh; color:#a8a29e; letter-spacing:0.06em; text-transform:uppercase; margin-top:auto; padding-top:3vh; }
</style></head>
<body><div class="page"><div class="bar"></div><div class="inner">
${cfg.showFacility ? `<div class="facility">${e(cfg.facilityName)}</div>` : ''}
${cfg.title ? `<div class="title">${e(cfg.title)}</div>` : ''}
${cfg.subtitle ? `<div class="subtitle">${e(cfg.subtitle)}</div>` : ''}
${cfg.dateLine ? `<div class="dateline">${e(cfg.dateLine)}</div>` : ''}
${lines ? `<div class="lines">${lines}</div>` : ''}
${cfg.footer ? `<div class="note">${e(cfg.footer)}</div>` : ''}
<div class="footer">Senior Stylist${cfg.facilityPhone ? ' · ' + e(cfg.facilityPhone) : ''}</div>
</div></div></body></html>`
}

export function SignageClient({ facilityName, facilityPhone }: { facilityName: string; facilityPhone: string | null }) {
  const { toast } = useToast()
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id)
  const [showFacility, setShowFacility] = useState(true)
  const [accent, setAccent] = useState(TEMPLATES[0].accent)
  const [title, setTitle] = useState(TEMPLATES[0].title)
  const [subtitle, setSubtitle] = useState(TEMPLATES[0].subtitle)
  const [dateLine, setDateLine] = useState(TEMPLATES[0].dateLine)
  const [body, setBody] = useState(TEMPLATES[0].body)
  const [footer, setFooter] = useState(TEMPLATES[0].footer)

  const applyTemplate = (t: Template) => {
    setTemplateId(t.id)
    setAccent(t.accent)
    setTitle(t.title)
    setSubtitle(t.subtitle)
    setDateLine(t.dateLine)
    setBody(t.body)
    setFooter(t.footer)
  }

  // P42 — URL prefill for the assistant's create_sign links (and shareable
  // sign URLs generally). Read on MOUNT via window.location (the imports-
  // client 12D idiom — no Suspense boundary, no hydration mismatch):
  // ?template=<id> picks the base template, then optional title/subtitle/
  // dateLine/body/footer/accent/showFacility override individual fields
  // (body carries encoded newlines). KEEP the param names in sync with the
  // create_sign tool in src/lib/ai-assistant/tools.ts.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if ([...params.keys()].length === 0) return
    const t = TEMPLATES.find((x) => x.id === params.get('template'))
    if (t) applyTemplate(t)
    const s = (k: string) => {
      const v = params.get(k)
      return v !== null && v.trim() !== '' ? v : null
    }
    const pTitle = s('title')
    const pSubtitle = s('subtitle')
    const pDateLine = s('dateLine')
    const pBody = s('body')
    const pFooter = s('footer')
    const pAccent = s('accent')
    if (pTitle) setTitle(pTitle.slice(0, 80))
    if (pSubtitle) setSubtitle(pSubtitle.slice(0, 120))
    if (pDateLine) setDateLine(pDateLine.slice(0, 80))
    if (pBody) setBody(pBody.slice(0, 600))
    if (pFooter) setFooter(pFooter.slice(0, 120))
    if (pAccent && /^#[0-9a-fA-F]{6}$/.test(pAccent)) setAccent(pAccent)
    if (params.get('showFacility') === '0') setShowFacility(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only prefill
  }, [])

  const cfg: SignConfig = { facilityName, facilityPhone, showFacility, accent, title, subtitle, dateLine, body, footer }
  const html = buildSignHtml(cfg)

  const print = async () => {
    // Native app: window.open/print don't exist in a webview — share the sign
    // as an HTML file instead (AirPrint / save / open in browser from the sheet).
    if (isNativeApp()) {
      const { shareBlobNative } = await import('@/lib/exports/native-file')
      const r = await shareBlobNative(new Blob([html], { type: 'text/html' }), 'sign.html')
      if (r.ok) toast.info('Use the share sheet to print or save the sign')
      else toast.error(r.error)
      return
    }
    const w = window.open('', '_blank', 'width=850,height=1100')
    if (!w) {
      toast.error('Allow pop-ups to print the sign.')
      return
    }
    w.document.write(html)
    w.document.close()
    w.focus()
    // Give the web fonts a beat to load before the print dialog snapshots the page.
    setTimeout(() => w.print(), 450)
  }

  const general = TEMPLATES.filter((t) => t.category === 'General')
  const holiday = TEMPLATES.filter((t) => t.category === 'Holiday')

  const inputCls = 'w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20'

  return (
    <div className="page-enter max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between gap-4 mb-6">
        <PageHeader icon={Printer} title="Signage" subtitle="Make a printable sign for the salon" />
        <button
          type="button"
          onClick={print}
          className="bg-[#8B2E4A] text-white text-sm font-semibold rounded-xl px-5 py-2.5 shadow-[0_2px_6px_rgba(139,46,74,0.22)] hover:bg-[#72253C] inline-flex items-center gap-2 shrink-0"
        >
          <Printer size={16} /> Print / Save PDF
        </button>
      </div>

      <div className="grid md:grid-cols-[360px_1fr] gap-6">
        {/* Controls */}
        <div className="space-y-5">
          <div>
            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">Template</p>
            {(['General', 'Holiday'] as const).map((cat) => (
              <div key={cat} className="mb-3">
                <p className="text-[11px] text-stone-400 mb-1.5">{cat}</p>
                <div className="flex flex-wrap gap-2">
                  {(cat === 'General' ? general : holiday).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => applyTemplate(t)}
                      className={`text-xs font-semibold rounded-lg px-3 py-1.5 border transition-colors ${templateId === t.id ? 'bg-[#8B2E4A] text-white border-[#8B2E4A]' : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'}`}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div>
            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">Color</p>
            <div className="flex flex-wrap gap-2">
              {ACCENTS.map((a) => (
                <button
                  key={a.v}
                  type="button"
                  onClick={() => setAccent(a.v)}
                  title={a.name}
                  className={`w-8 h-8 rounded-full border-2 transition-transform ${accent === a.v ? 'border-stone-800 scale-110' : 'border-white shadow'}`}
                  style={{ backgroundColor: a.v }}
                />
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <label className="flex items-center justify-between text-sm text-stone-700">
              <span>Show facility name</span>
              <button
                type="button"
                role="switch"
                aria-checked={showFacility}
                onClick={() => setShowFacility((s) => !s)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${showFacility ? 'bg-[#8B2E4A]' : 'bg-stone-200'}`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${showFacility ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </label>
            <div>
              <label className="text-xs font-semibold text-stone-600 block mb-1">Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-semibold text-stone-600 block mb-1">Subtitle</label>
              <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-semibold text-stone-600 block mb-1">Date / time banner</label>
              <input value={dateLine} onChange={(e) => setDateLine(e.target.value)} placeholder="e.g. Every Tuesday · 10am" className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-semibold text-stone-600 block mb-1">Body (one line each)</label>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className={`${inputCls} resize-none`} />
            </div>
            <div>
              <label className="text-xs font-semibold text-stone-600 block mb-1">Footer note</label>
              <input value={footer} onChange={(e) => setFooter(e.target.value)} className={inputCls} />
            </div>
          </div>
        </div>

        {/* Live preview */}
        <div>
          <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">Preview</p>
          <div className="rounded-2xl border border-stone-200 shadow-[var(--shadow-md)] overflow-hidden bg-white">
            <iframe srcDoc={html} title="Sign preview" className="w-full aspect-[8.5/11] block" />
          </div>
          <p className="text-[11px] text-stone-400 mt-2 text-center">Prints on a standard portrait page. Use your browser’s “Save as PDF” to download.</p>
        </div>
      </div>
    </div>
  )
}
