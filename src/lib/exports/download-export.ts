// Client-side export download helper. Replaces window.open(url) for export
// endpoints: window.open can't surface API error responses — a 400/403/429 JSON
// body just renders in a blank tab (the "Invalid Error" the bookkeepers reported).
// fetch + blob lets the caller toast the real error message and keeps the user
// on the page while the file downloads.
export async function downloadExportFile(
  url: string,
  fallbackName: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(url)
    if (!res.ok) {
      let msg = `Export failed (${res.status})`
      try {
        const j = await res.json()
        if (typeof j?.error === 'string') msg = j.error
      } catch {
        /* non-JSON error body — keep the status fallback */
      }
      return { ok: false, error: msg }
    }
    const blob = await res.blob()
    const cd = res.headers.get('Content-Disposition') ?? ''
    const filename = cd.match(/filename="([^"]+)"/)?.[1] ?? fallbackName
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Delay revocation so the browser finishes reading the blob
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Network error — please try again.' }
  }
}
