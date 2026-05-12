// Phase 12W — Module-level handler ref for the global peek drawer.
//
// The drawer is mounted once in (protected)/layout.tsx. Any component
// anywhere in the tree (daily log row, billing row, calendar event) can
// call openPeek({...}) to slide it open without prop drilling. Same
// pattern as tour-router.ts.

export type PeekTarget =
  | { type: 'resident'; id: string }
  | { type: 'stylist'; id: string }

let _openPeek: ((target: PeekTarget) => void) | null = null

export function setPeekHandler(fn: (target: PeekTarget) => void) {
  _openPeek = fn
}

export function openPeek(target: PeekTarget) {
  _openPeek?.(target)
}
