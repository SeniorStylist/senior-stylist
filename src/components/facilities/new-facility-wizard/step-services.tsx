'use client'

// P57 — Step 4 (manage tier only): the price list. Upload the facility's
// price sheet (PDF/photo/spreadsheet) → the existing parser reads it →
// preview → POST /api/services/bulk with the explicit facilityId. Rows land
// as `price_list` so families can request them. Skippable.

import { useRef, useState } from 'react'
import { FileText, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { formatMoney } from '@/lib/format'
import type { ParsedPriceRow } from '@/lib/services-import-parse'
import { Card, InlineError, StepIntro } from './wizard-ui'
import type { CreatedFacility, WizardState } from './wizard-types'

interface Props {
  facility: CreatedFacility
  value: WizardState['services']
  onChange: (next: WizardState['services']) => void
  error: string | null
  onError: (msg: string | null) => void
}

export function StepServices({ facility, value, onChange, error, onError }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [rows, setRows] = useState<ParsedPriceRow[]>([])
  const [fileName, setFileName] = useState<string | null>(null)

  const parse = async (file: File) => {
    setParsing(true)
    onError(null)
    setRows([])
    setFileName(file.name)
    try {
      const { parsePriceSheetFile } = await import('@/lib/services-import-parse')
      const result = await parsePriceSheetFile(file)
      if (result.rows.length === 0) {
        onError('No services could be read from that file.')
        return
      }
      setRows(result.rows)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not read that price sheet')
    } finally {
      setParsing(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const removeRow = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i))

  const save = async () => {
    setSaving(true)
    onError(null)
    try {
      const res = await fetch('/api/services/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facilityId: facility.id,
          rows: rows.map((r) => ({
            name: r.name,
            priceCents: r.priceCents,
            durationMinutes: r.durationMinutes || 30,
            color: r.color,
            pricingType: r.pricingType === 'per_unit' ? 'fixed' : r.pricingType,
            addonAmountCents: r.addonAmountCents,
            pricingTiers: r.pricingTiers ?? undefined,
            pricingOptions: r.pricingOptions ?? undefined,
            category: r.category || null,
          })),
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        onError(typeof j.error === 'string' ? j.error : 'Could not save the services')
        return
      }
      const d = (j.data ?? {}) as { created?: number; skipped?: number; count?: number }
      const created = d.created ?? d.count ?? rows.length
      onChange({ created: (value?.created ?? 0) + created, skipped: (value?.skipped ?? 0) + (d.skipped ?? 0) })
      setRows([])
      setFileName(null)
    } catch {
      onError('Network error — the services were not saved')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <StepIntro
        title="What does the salon offer?"
        blurb="Upload the price sheet and we’ll read it. Families pick from these when they request a visit. You can skip this."
      />
      <div className="space-y-5">
        <InlineError message={error} />

        {value && value.created > 0 && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {value.created} service{value.created === 1 ? '' : 's'} added to {facility.name}
            {value.skipped > 0 ? ` (${value.skipped} duplicate${value.skipped === 1 ? '' : 's'} skipped)` : ''}.
          </div>
        )}

        {rows.length === 0 ? (
          <Card>
            <EmptyState
              icon={<FileText size={20} />}
              title={value && value.created > 0 ? 'Add another sheet?' : 'No price sheet yet'}
              description="PDF, photo, Word, Excel or CSV — the scanner reads service names and prices."
            />
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.docx,.csv,.xlsx,.xls,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void parse(f)
              }}
            />
            <div className="flex justify-center">
              <Button type="button" size="lg" loading={parsing} onClick={() => fileRef.current?.click()} data-tour="wizard-services-upload">
                <Upload size={16} /> {parsing ? 'Reading the sheet…' : 'Upload price sheet'}
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-100 bg-stone-50/60 flex items-center justify-between gap-3">
              <p className="text-[11px] text-stone-400 uppercase tracking-wide font-semibold truncate">
                {rows.length} services read from {fileName}
              </p>
              <button type="button" onClick={() => setRows([])} className="text-xs text-stone-500 hover:text-red-600 shrink-0">
                Start over
              </button>
            </div>
            <div className="max-h-[50vh] overflow-y-auto overscroll-contain">
              <ul className="divide-y divide-stone-100">
                {rows.map((r, i) => (
                  <li key={`${r.name}-${i}`} className="px-4 py-3 flex items-center gap-3">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-semibold text-stone-900 leading-snug truncate">{r.name}</p>
                      <p className="text-[11.5px] text-stone-500 leading-snug mt-0.5">
                        {r.category || 'Uncategorized'} · {r.durationMinutes || 30} min
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-stone-900 whitespace-nowrap">
                      {r.pricingType === 'addon' && r.addonAmountCents != null
                        ? `+${formatMoney(r.addonAmountCents)}`
                        : r.pricingType === 'multi_option' && r.pricingOptions?.length
                          ? `from ${formatMoney(Math.min(...r.pricingOptions.map((o) => o.priceCents)))}`
                          : formatMoney(r.priceCents)}
                    </span>
                    <button type="button" onClick={() => removeRow(i)} aria-label={`Remove ${r.name}`} className="text-stone-300 hover:text-red-600 text-lg leading-none px-1">
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="px-4 py-3 border-t border-stone-100 flex justify-end">
              <Button type="button" size="lg" loading={saving} onClick={save} data-tour="wizard-services-save">
                Add {rows.length} service{rows.length === 1 ? '' : 's'}
              </Button>
            </div>
          </Card>
        )}
      </div>
    </>
  )
}
