'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'

interface ImportResult {
  facilities: { created: number; updated: number }
  residents: { created: number; updated: number; skipped: number }
  warnings: string[]
}

type State = 'upload' | 'loading' | 'results'

export function ImportQuickbooksClient() {
  const [state, setState] = useState<State>('upload')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleImport() {
    if (!selectedFile) return
    setError(null)
    setState('loading')
    setProgress(0)

    // Two-phase progress bar
    setTimeout(() => setProgress(70), 50)

    try {
      const formData = new FormData()
      formData.append('file', selectedFile)
      const res = await fetch('/api/super-admin/import-quickbooks', {
        method: 'POST',
        body: formData,
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Import failed')

      setProgress(100)
      await new Promise((r) => setTimeout(r, 400))
      setResult(json.data)
      setState('results')
    } catch (err) {
      setProgress(100)
      await new Promise((r) => setTimeout(r, 200))
      setError((err as Error).message)
      setState('upload')
    }
  }

  function reset() {
    setSelectedFile(null)
    setResult(null)
    setError(null)
    setProgress(0)
    setState('upload')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="min-h-screen bg-stone-50 p-6">
      {/* Loading overlay */}
      {state === 'loading' && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm mx-4">
            <div className="w-12 h-12 rounded-full bg-rose-50 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-[#8B2E4A]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-stone-900 text-center mb-1">Importing from QuickBooks...</h3>
            <p className="text-sm text-stone-500 text-center mb-5">Creating facilities and residents — this may take a minute</p>
            <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#8B2E4A] rounded-full"
                style={{
                  width: `${progress}%`,
                  transition: progress === 70
                    ? 'width 3s cubic-bezier(0.4, 0, 0.2, 1)'
                    : 'width 0.4s ease-out',
                }}
              />
            </div>
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto">
        {/* Back link */}
        <Link href="/super-admin" className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-700 mb-6">
          <span>←</span> Back to Super Admin
        </Link>

        {state !== 'results' ? (
          /* Upload card */
          <div className="bg-white rounded-2xl border border-stone-200 p-8">
            <h1
              className="text-2xl font-bold text-stone-900 mb-2"
              style={{ fontFamily: "'DM Serif Display', serif", color: '#8B2E4A' }}
            >
              Import from QuickBooks
            </h1>
            <p className="text-sm text-stone-500 mb-8">
              Upload your QuickBooks Customer export (XLS or XLSX) to bulk-create facilities and residents.
              Safe to run multiple times — duplicates are detected by QB customer ID.
            </p>

            {error && (
              <div className="mb-6 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
                {error}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept=".xls,.xlsx"
              className="hidden"
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
            />

            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-stone-200 rounded-xl p-10 text-center cursor-pointer hover:border-[#8B2E4A] hover:bg-rose-50/30 transition-colors mb-6"
            >
              <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-3">
                <svg className="w-5 h-5 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              {selectedFile ? (
                <p className="text-sm font-medium text-stone-700">{selectedFile.name}</p>
              ) : (
                <>
                  <p className="text-sm font-medium text-stone-600">Click to select a file</p>
                  <p className="text-xs text-stone-400 mt-1">XLS or XLSX</p>
                </>
              )}
            </div>

            <button
              onClick={handleImport}
              disabled={!selectedFile}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#8B2E4A' }}
              onMouseEnter={(e) => { if (selectedFile) e.currentTarget.style.backgroundColor = '#72253C' }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#8B2E4A' }}
            >
              Import
            </button>
          </div>
        ) : (
          /* Results card */
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
                  <span className="text-sm font-medium text-stone-700">Facilities</span>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-emerald-700 font-semibold">{result.facilities.created.toLocaleString()} created</span>
                    <span className="text-stone-400">|</span>
                    <span className="text-stone-600">{result.facilities.updated.toLocaleString()} updated</span>
                  </div>
                </div>
                <div className="flex items-center justify-between px-4 py-3 bg-stone-50 rounded-xl">
                  <span className="text-sm font-medium text-stone-700">Residents</span>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-emerald-700 font-semibold">{result.residents.created.toLocaleString()} created</span>
                    <span className="text-stone-400">|</span>
                    <span className="text-stone-600">{result.residents.updated.toLocaleString()} updated</span>
                    {result.residents.skipped > 0 && (
                      <>
                        <span className="text-stone-400">|</span>
                        <span className="text-amber-600">{result.residents.skipped.toLocaleString()} skipped</span>
                      </>
                    )}
                  </div>
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
                  href="/super-admin"
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white text-center transition-colors"
                  style={{ backgroundColor: '#8B2E4A' }}
                >
                  Go to Super Admin →
                </Link>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  )
}
