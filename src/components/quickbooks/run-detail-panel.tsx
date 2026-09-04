'use client'

// The expanded body of a Sync History row: what one QuickBooks operation
// changed, in two columns — "In QuickBooks" and "On the site". Every string is
// rendered server-side (money, dates in the facility's timezone), so this file
// only lays out what it is handed.

import type { DetailSide, DetailTable, RunDetail, Tone } from '@/lib/qb-run-detail'

export interface RunDetailResponse extends RunDetail {
  undo: {
    at: string | null
    reversed: number
    skipped: number
    notes: string[]
    errors: string[]
  } | null
}

const TONE_TEXT: Record<Tone, string> = {
  default: 'text-stone-700',
  good: 'text-emerald-700',
  warn: 'text-amber-700',
  muted: 'text-stone-400',
}

function Table({ table }: { table: DetailTable }) {
  return (
    <div className="mt-3 first:mt-0">
      <div className="text-[11px] font-semibold text-stone-600">{table.title}</div>
      <p className="text-[11px] text-stone-500 mt-0.5 leading-snug">{table.caption}</p>

      {table.unrecorded ? (
        <p className="mt-1.5 text-[11px] italic text-stone-400">{table.unrecorded}</p>
      ) : (
        <div className="mt-1.5 overflow-x-auto">
          <table className="w-full text-[11px] border-separate border-spacing-0">
            <thead>
              <tr>
                {table.columns.map((c, i) => (
                  <th
                    key={i}
                    className={`text-[10px] uppercase tracking-wide text-stone-400 font-semibold border-b border-stone-100 pb-1 pr-3 whitespace-nowrap ${
                      c.align === 'right' ? 'text-right' : 'text-left'
                    }`}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, ri) => (
                <tr key={ri} className="align-top">
                  {row.cells.map((cell, ci) => (
                    <td
                      key={ci}
                      className={`py-1 pr-3 ${cell.align === 'right' ? 'text-right' : 'text-left'} ${
                        cell.mono ? 'font-mono' : ''
                      } ${TONE_TEXT[cell.tone ?? row.tone ?? 'default']}`}
                    >
                      {cell.text}
                      {ci === 0 && row.note && (
                        <span className="block text-[10.5px] text-stone-400 font-sans mt-0.5">
                          {row.note}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {table.more ? (
        <p className="mt-1 text-[10.5px] text-stone-400">+{table.more} more not listed</p>
      ) : null}
    </div>
  )
}

function Side({ side, label, accent }: { side: DetailSide; label: string; accent: string }) {
  return (
    <div className="min-w-0">
      <div className={`text-[10px] font-semibold uppercase tracking-wide ${accent}`}>{label}</div>
      <p className="text-[11.5px] font-medium text-stone-700 mt-1 leading-snug">{side.headline}</p>
      {side.note && <p className="text-[11px] text-stone-500 mt-1 leading-snug">{side.note}</p>}
      {side.tables.map((t, i) => (
        <Table key={i} table={t} />
      ))}
    </div>
  )
}

export function RunDetailPanel({ detail }: { detail: RunDetailResponse }) {
  const undo = detail.undo
  return (
    <div className="rounded-lg border border-stone-100 bg-stone-50/60 px-3 py-3">
      {undo?.at && (
        <div className="mb-3 rounded-lg bg-stone-100 px-3 py-2 text-[11px] text-stone-600">
          {/* "Undone" only means the reversal hit no errors — rows it chose to
              leave alone are reported separately, never implied as reversed. */}
          Undone · {undo.reversed} reversed
          {undo.skipped > 0 ? `, ${undo.skipped} left alone` : ''}
          {undo.notes.length > 0 && (
            <ul className="mt-1 list-disc list-inside text-stone-500">
              {undo.notes.slice(0, 5).map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {undo && !undo.at && undo.errors.length > 0 && (
        <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800">
          An undo was attempted and didn’t finish: {undo.errors[0]}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
        <Side side={detail.quickbooks} label="In QuickBooks" accent="text-[#8B2E4A]" />
        <Side side={detail.site} label="On the site" accent="text-stone-500" />
      </div>

      {(detail.warnings.length > 0 || detail.errors.length > 0) && (
        <div className="mt-3 pt-3 border-t border-stone-200 space-y-1">
          {detail.warnings.map((w, i) => (
            <p key={`w${i}`} className="text-[11px] text-amber-700">
              {w}
            </p>
          ))}
          {detail.errors.map((e, i) => (
            <p key={`e${i}`} className="text-[11px] text-rose-700">
              {e}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
