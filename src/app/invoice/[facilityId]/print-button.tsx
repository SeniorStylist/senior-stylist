'use client'

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
      style={{ backgroundColor: '#0D7377' }}
    >
      Print Invoice
    </button>
  )
}
