'use client'

export type DefaultTipType = 'percentage' | 'fixed' | null

export interface DefaultTipValue {
  type: DefaultTipType
  // percent (0-100) when type='percentage'; cents when type='fixed'
  value: number | null
}

interface Props {
  value: DefaultTipValue
  onChange: (next: DefaultTipValue) => void
  disabled?: boolean
}

const PERCENT_PILLS = [10, 15, 18, 20]

export function DefaultTipPicker({ value, onChange, disabled }: Props) {
  const setType = (next: DefaultTipType) => {
    if (next === value.type) return
    if (next === null) onChange({ type: null, value: null })
    else onChange({ type: next, value: null })
  }

  return (
    <div>
      <p className="text-sm font-medium text-stone-700 mb-2">Default Tip</p>
      <div className="flex gap-2 mb-3">
        <ToggleButton active={value.type === null} disabled={disabled} onClick={() => setType(null)}>
          None
        </ToggleButton>
        <ToggleButton active={value.type === 'percentage'} disabled={disabled} onClick={() => setType('percentage')}>
          %
        </ToggleButton>
        <ToggleButton active={value.type === 'fixed'} disabled={disabled} onClick={() => setType('fixed')}>
          $
        </ToggleButton>
      </div>

      {value.type === 'percentage' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              inputMode="numeric"
              value={value.value ?? ''}
              onChange={(e) => {
                const n = e.target.value === '' ? null : Math.max(0, Math.min(100, Math.round(Number(e.target.value))))
                onChange({ type: 'percentage', value: Number.isFinite(n as number) ? n : null })
              }}
              disabled={disabled}
              placeholder="15"
              className="w-20 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20 transition-all"
            />
            <span className="text-sm text-stone-500">% of service price</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PERCENT_PILLS.map((pct) => (
              <button
                type="button"
                key={pct}
                disabled={disabled}
                onClick={() => onChange({ type: 'percentage', value: pct })}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  value.value === pct
                    ? 'bg-[#8B2E4A] text-white'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                }`}
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>
      )}

      {value.type === 'fixed' && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-stone-500">$</span>
          <input
            type="number"
            min={0}
            step={0.01}
            inputMode="decimal"
            value={value.value == null ? '' : (value.value / 100).toFixed(2)}
            onChange={(e) => {
              const dollars = e.target.value === '' ? null : Number(e.target.value)
              const cents =
                dollars == null || !Number.isFinite(dollars) ? null : Math.max(0, Math.round(dollars * 100))
              onChange({ type: 'fixed', value: cents })
            }}
            disabled={disabled}
            placeholder="2.00"
            className="w-28 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20 transition-all"
          />
          <span className="text-sm text-stone-500">per booking</span>
        </div>
      )}

      <p className="text-xs text-stone-500 mt-2">
        Auto-fills the tip field when a new booking is created for this resident.
      </p>
    </div>
  )
}

function ToggleButton({
  children,
  active,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  active: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
        active
          ? 'bg-[#8B2E4A] text-white shadow-[0_2px_6px_rgba(139,46,74,0.22)]'
          : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
      } disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  )
}
