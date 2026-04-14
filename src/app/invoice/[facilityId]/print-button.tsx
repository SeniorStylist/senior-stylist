'use client'

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
      style={{ backgroundColor: '#8B2E4A' }}
    >
      Print Invoice
    </button>
  )
}
