// Phase 23 — stale-build (chunk-load) error recovery.
//
// After a deploy, an open tab still runs the OLD build; the next lazy import
// (route chunk on a nav tap, a dynamic modal, xlsx/recharts, the tour engine)
// can request a chunk the CDN no longer serves → ChunkLoadError. The only real
// fix is a full reload (fresh HTML → current chunks); re-rendering the stale
// bundle (error boundary reset()) can never succeed.
//
// reloadOnceForChunkError() reloads AT MOST once per 10s window (sessionStorage
// guard) so a chunk error that a reload can't fix — e.g. offline-served cached
// HTML referencing never-cached chunks — falls through to the visible error UI
// instead of looping.

const GUARD_KEY = 'ss_chunk_reload_at'
const GUARD_WINDOW_MS = 10_000

export function isChunkError(e: unknown): boolean {
  const err = e as { name?: string; message?: string } | null | undefined
  const name = err?.name ?? ''
  const msg = String(err?.message ?? e ?? '')
  return (
    name === 'ChunkLoadError' ||
    /Loading chunk [\w-]+ failed|Failed to (load|fetch) [^\s]*chunk|dynamically imported module|Importing a module script failed/i.test(msg)
  )
}

/** Reload once to pick up the new build. Returns false when the guard blocked it. */
export function reloadOnceForChunkError(): boolean {
  try {
    const now = Date.now()
    const last = Number(sessionStorage.getItem(GUARD_KEY) ?? 0)
    if (now - last < GUARD_WINDOW_MS) return false
    sessionStorage.setItem(GUARD_KEY, String(now))
  } catch {
    /* private browsing — still reload once per page lifetime via the throw below */
  }
  window.location.reload()
  return true
}
