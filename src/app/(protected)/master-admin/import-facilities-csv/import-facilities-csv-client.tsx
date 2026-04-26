'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'

interface ImportResult {
  updated: number
  skipped: number
  namesFilled: number
  emailsFilled: number
  revShareSet: number
  warnings: string[]
}

type State = 'upload' | 'loading' | 'results'

export function ImportFacilitiesCSVClient() {
  const [state, setState] = useState<State>('upload')
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleImport() {
    if (!csvFile) return
    setError(null)
    setState('loading')
    setProgress(0)
    setTimeout(() => setProgress(70), 50)

    try {
      const formData = new FormData()
      formData.append('csv', csvFile)

      const res = await fetch('/api/super-admin/import-facilities-csv', {
        method: 'POST',
        body: formData,
      })
      const text = await res.text().catch(() => '')
      let json: { data?: ImportResult; error?: string } = {}
      try { json = JSON.parse(text) } catch { throw new Error(text.slice(0, 200) || `Server error (${res.status})`) }
      if (!res.ok) throw new Error(json.error ?? 'Import failed')

      setProgress(100)
      await new Promise((r) => setTimeout(r, 400))
      setResult(json.data ?? null)
      setState('results')
    } catch (err) {
      setProgress(100)
      await new Promise((r) => setTimeout(r, 200))
      setError((err as Error).message)
      setState('upload')
    }
  }

  function reset() {
    setCsvFile(null)
    setResult(null)
    setError(null)
    setProgress(0)
    setState('upload')
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="min-h-screen bg-stone-50 p-6">
      {state === 'loading' && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm mx-4">
            <div className="w-12 h-12 rounded-full bg-rose-50 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-[#8B2E4A]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 19h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-stone-900 text-center mb-1">Updating Facilities…</h3>
            <p className="text-sm text-stone-500 text-center mb-5">Matching rows and writing changes</p>
            <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#8B2E4A] rounded-full"
                style={{
                  width: `${progress}%`,
                  transition: progress === 70 ? 'width 2s cubic-bezier(0.4, 0, 0.2, 1)' : 'width 0.4s ease-out',
                }}
              />
            </div>
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto">
        <Link href="/master-admin" className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-700 mb-6">
          <span>←</span> Back to Master Admin
        </Link>

        {state !== 'results' ? (
          <div className="bg-white rounded-2xl border border-stone-200 p-8">
            <h1
              className="text-2xl font-bold text-stone-900 mb-2"
              style={{ fontFamily: "'DM Serif Display', serif", color: '#8B2E4A' }}
            >
              Update Facilities from CSV
            </h1>
            <p className="text-sm text-stone-500 mb-8">
              Import facility data from the master spreadsheet. Matched by F-code (col B). Names and
              emails fill only when blank. Payment type, rev share, phone, and address are always
              overwritten when present in the CSV.
            </p>

            {error && (
              <div className="mb-6 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
                {error}
              </div>
            )}

            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
            />
            <div className="mb-8">
              <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">Facilities CSV</p>
              <p className="text-xs text-stone-400 mb-3">
                Expected columns: <span className="font-mono">Name</span>, <span className="font-mono">Contact Email</span>, <span className="font-mono">Payment Type</span>, <span className="font-mono">Rev Share %</span>
              </p>
              <div
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-stone-200 rounded-xl p-6 text-center cursor-pointer hover:border-[#8B2E4A] hover:bg-rose-50/30 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-2">
                  <svg className="w-4 h-4 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                {csvFile ? (
                  <p className="text-sm font-medium text-stone-700">{csvFile.name}</p>
                ) : (
                  <p className="text-sm font-medium text-stone-600">Click to select CSV file</p>
                )}
              </div>
            </div>

            <button
              onClick={handleImport}
              disabled={!csvFile}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#8B2E4A' }}
              onMouseEnter={(e) => { if (csvFile) e.currentTarget.style.backgroundColor = '#72253C' }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#8B2E4A' }}
            >
              Import
            </button>
          </div>
        ) : (
          result && (
            <div className="bg-white rounded-2xl border border-stone-200 p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center">
                  <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-stone-900">Import Complete</h2>
              </div>

              <div className="space-y-3 mb-6">
                <div className="flex items-center justify-between px-4 py-3 bg-stone-50 rounded-xl">
                  <span className="text-sm font-medium text-stone-700">Facilities updated</span>
                  <span className="text-sm font-semibold text-emerald-700">{result.updated.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3 bg-stone-50 rounded-xl">
                  <span className="text-sm font-medium text-stone-700">Rows skipped (no match)</span>
                  <span className="text-sm font-semibold text-stone-700">{result.skipped.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3 bg-stone-50 rounded-xl">
                  <span className="text-sm font-medium text-stone-700">Names filled</span>
                  <span className="text-sm font-semibold text-stone-700">{result.namesFilled.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3 bg-stone-50 rounded-xl">
                  <span className="text-sm font-medium text-stone-700">Contact emails filled</span>
                  <span className="text-sm font-semibold text-stone-700">{result.emailsFilled.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3 bg-stone-50 rounded-xl">
                  <span className="text-sm font-medium text-stone-700">Rev share % set</span>
                  <span className="text-sm font-semibold text-stone-700">{result.revShareSet.toLocaleString()}</span>
                </div>
              </div>

              {result.warnings.length > 0 && (
                <details className="mb-6 rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
                  <summary className="px-4 py-3 text-sm font-medium text-amber-700 cursor-pointer select-none">
                    {result.warnings.length} warning{result.warnings.length !== 1 ? 's' : ''}
                  </summary>
                  <ul className="px-4 pb-3 space-y-1">
                    {result.warnings.map((w, i) => (
                      <li key={i} className="text-xs text-amber-700">{w}</li>
                    ))}
                  </ul>
                </details>
              )}

              <div className="flex items-center gap-3">
                <button
                  onClick={reset}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors"
                >
                  Import Another File
                </button>
                <Link
                  href="/master-admin"
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white text-center transition-colors"
                  style={{ backgroundColor: '#8B2E4A' }}
                >
                  Go to Master Admin →
                </Link>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  )
}
