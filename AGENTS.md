# Senior Stylist — Agent Rules

## Read brain files first
Before any work, read:
- CLAUDE.md
- docs/master-spec.md
- docs/design-system.md
- docs/project-context.md

## Next.js
Always read the relevant doc in node_modules/next/dist/docs/ before writing Next.js code. Training data is outdated — the bundled docs are the source of truth.

## Non-negotiable rules
- Every DB query scoped to facilityId
- RLS enabled on every new table with service_role_all policy
- Prices always in cents, never floats
- Never hard delete — always active = false
- Never await sendEmail()
- Next.js 16 async params: always { params: Promise<{id: string}> }
- git add -A always (project path has parentheses that break zsh globs)
- Run npx tsc --noEmit before every commit
