// P42 — safe in-chat links. The assistant's create_sign / create_statement
// tools return SAME-ORIGIN relative paths; the chat bubble renders ONLY
// paths matching this hard prefix allowlist as tappable links — everything
// else (including any external URL) stays plain text. Pure module so the
// harness can unit-test the matcher.

const ALLOWED_PREFIXES = ['/signage', '/invoice/', '/api/billing/statement/'] as const

// A relative app path token: starts with one of the allowed prefixes and
// runs to whitespace. Query strings allowed; no quotes/backticks captured.
const PATH_RE = /(^|\s)(\/(?:signage|invoice\/|api\/billing\/statement\/)[^\s"'`<>]*)/g

export interface MessageSegment {
  type: 'text' | 'link'
  value: string
}

export function isAllowedAppLink(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//')) return false
  return ALLOWED_PREFIXES.some((p) => path.startsWith(p))
}

/** Split a model message into text + allowlisted link segments. */
export function segmentMessage(text: string): MessageSegment[] {
  const segments: MessageSegment[] = []
  let last = 0
  for (const m of text.matchAll(PATH_RE)) {
    const path = m[2]
    if (!isAllowedAppLink(path)) continue
    const start = (m.index ?? 0) + m[1].length
    if (start > last) segments.push({ type: 'text', value: text.slice(last, start) })
    segments.push({ type: 'link', value: path })
    last = start + path.length
  }
  if (last < text.length) segments.push({ type: 'text', value: text.slice(last) })
  return segments.length ? segments : [{ type: 'text', value: text }]
}
