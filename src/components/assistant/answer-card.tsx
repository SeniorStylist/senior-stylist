'use client'

// P47 — rich answer card renderer for the assistant chat. Cards are
// tool-built server-side (answer-cards.ts — never model-authored) and
// validated with isAnswerCard before they reach this component. Entities
// (residents/stylists) render as tappable buttons opening the global peek
// drawer — the peek API re-checks role access server-side.

import type { AnswerCard, CardEntity } from '@/lib/ai-assistant/answer-cards'
import { openPeek } from '@/lib/peek-drawer'

function EntityText({ text, entity }: { text: string; entity?: CardEntity }) {
  if (!entity) return <>{text}</>
  return (
    <button
      type="button"
      onClick={() => openPeek(entity)}
      className="text-[#8B2E4A] font-semibold underline decoration-[#E8CDD5] underline-offset-2 hover:decoration-[#8B2E4A] transition-colors text-left"
    >
      {text}
    </button>
  )
}

export function AssistantAnswerCard({ card }: { card: AnswerCard }) {
  return (
    <div className="w-full rounded-2xl border border-[#E8CDD5] bg-white overflow-hidden shadow-[var(--shadow-sm)]">
      <div className="bg-[#F9EFF2] px-3.5 py-2 text-[12px] font-semibold text-[#8B2E4A]">{card.title}</div>

      {card.kind === 'stats' && (
        <div className="grid grid-cols-2 gap-px bg-stone-100">
          {card.stats.map((s, i) => (
            <div key={i} className="bg-white px-3.5 py-2.5">
              <p className="text-[10.5px] font-semibold text-stone-400 uppercase tracking-wide">{s.label}</p>
              <p className="text-[15px] font-semibold text-stone-900 leading-snug">{s.value}</p>
              {s.hint && <p className="text-[11px] text-stone-500 leading-snug">{s.hint}</p>}
            </div>
          ))}
        </div>
      )}

      {card.kind === 'table' && (
        <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-stone-50/60">
                {card.columns.map((c, i) => (
                  <th key={i} className="px-3 py-1.5 text-left text-[10.5px] font-semibold text-stone-400 uppercase tracking-wide whitespace-nowrap">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {card.rows.map((row, i) => (
                <tr key={i} className="border-t border-stone-100">
                  {row.map((cell, j) => (
                    <td key={j} className="px-3 py-1.5 text-stone-700 whitespace-nowrap">
                      <EntityText text={cell.text} entity={cell.entity} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {card.kind === 'list' && (
        <ul>
          {card.items.map((item, i) => (
            <li key={i} className="px-3.5 py-2 border-t border-stone-100 first:border-t-0">
              <p className="text-[13px] leading-snug">
                <EntityText text={item.text} entity={item.entity} />
              </p>
              {item.secondary && <p className="text-[11.5px] text-stone-500 leading-snug mt-0.5">{item.secondary}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
