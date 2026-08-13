// Pull a human-readable message out of an API error response. Handles a plain
// string `error`, a Zod `flatten()` object ({ fieldErrors, formErrors }), and
// the `{ error: { fieldErrors, formErrors } }` shape routes return on 422.
// P53 — extracted from log-client.tsx: rendering a flatten() OBJECT as a React
// child crashes the component ("Objects are not valid as a React child" —
// the signup wizard unmounted and lost all typed data on any 422).
export function firstErrorMessage(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null
  const err = (json as { error?: unknown }).error
  if (typeof err === 'string') return err
  const obj = (err && typeof err === 'object' ? err : json) as {
    fieldErrors?: Record<string, string[]>
    formErrors?: string[]
  }
  const field = obj.fieldErrors && Object.values(obj.fieldErrors).flat().find(Boolean)
  if (field) return field
  const form = obj.formErrors?.find(Boolean)
  return form ?? null
}
