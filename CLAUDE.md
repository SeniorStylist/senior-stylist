# Senior Stylist — Claude Code Rules

## Project
- Live site: https://senior-stylist.vercel.app
- GitHub: https://github.com/SeniorStylist/senior-stylist
- Supabase project: goomnlsdguetfgwjpwer

## Non-Negotiable Rules

### Database
- ALWAYS scope every DB query to facilityId — never return data across facilities
- NEVER hard delete records — always use active=false
- Prices are ALWAYS stored in cents (integers) in the DB
- Display prices by dividing by 100, NEVER store floats
- After ANY schema change run: npx dotenv -e .env.local -- npx drizzle-kit push
- facilityUsers.role is the authoritative role — not profiles.role

### Git
- ALWAYS use git add -A (project path has parentheses that break zsh globs)
- NEVER commit .env.local
- Always run npx tsc --noEmit before committing — fix all errors first

### Auth & Roles
- role 'admin' — full access to everything
- role 'stylist' — calendar, log, own earnings only. No reports, no settings
- role 'viewer' — read-only, no edits
- Super admin bypasses all checks via NEXT_PUBLIC_SUPER_ADMIN_EMAIL env var
- Portal routes (/portal/*) are PUBLIC — token = auth, no login required
- Invoice routes (/invoice/*) are PUBLIC — printable pages

### API Routes
- Every API route must check auth via Supabase createClient().auth.getUser()
- Every API route must scope to facilityId via getUserFacility()
- Return { data: ... } on success, { error: "message" } on failure
- Always wrap DB queries in try/catch — never let a DB error crash a page

### Database Connection
- Use the pooler URL (port 5432, session mode) for DATABASE_URL
- max: 3 connections, idle_timeout: 20, connect_timeout: 10
- The client is a singleton via globalThis._pgClient

### UI / Design
- Design system: stone colors, #0D7377 teal primary, rounded-2xl cards
- Fonts: DM Serif Display (headings), DM Sans (body)
- Bottom sheets on mobile, modals on desktop
- All bottom sheets: fixed overlay → flex-col → justify-end structure
- Footer/save buttons ALWAYS outside scroll area (flexShrink: 0)
- viewport-fit=cover required in layout.tsx for iPhone safe areas

### Common Bugs to Avoid
- NEVER use new URL(request.url).origin for redirects on Vercel — use request.nextUrl.clone()
- NEVER put page.tsx files inside /app/api/ directories
- NEVER set selectMirror=true on FullCalendar (causes squish bug)
- NEVER make Google Calendar sync block a response — always fire-and-forget
- NEVER use position:sticky inside overflow:auto on iOS — use flexShrink:0 footer instead
- ALWAYS call api.unselect() immediately in FullCalendar onSelect handler
- NEVER use pdf-parse or @napi-rs/canvas on Vercel — use unpdf (no native deps)
- PDF text from unpdf comes out as ONE blob with no newlines — never split('\n')
- PDF blob parsing MUST use the alternating-chunks approach: split on price numbers with capture group → alternating [text, price, text, price...] array → walk even-index text chunks → detect category changes via ' Price ' substring in the chunk. NEVER use a single regex to extract service names from a flat blob — character classes break on apostrophes/em-dashes and category names bleed into service names.
- PDF category headers (e.g. "Color", "Perms & Relaxers") appear as no-price text chunks — when hasPrice is false and the chunk is not garbage (length >= 3, not starting with *, not "Price"), treat it as the new currentCategory.
- React does NOT support indeterminate as a JSX prop — set via callback ref: ref={(el) => { if (el) el.indeterminate = ... }}
- Drizzle inArray() throws on empty array — always guard with .min(1) in Zod schema
- Floating action bars should use z-40 (not z-50) so they don't cover the mobile nav
- drizzle-kit push will interactively prompt when it detects constraints that already exist in the DB — if it hangs, add the columns directly via the postgres driver (node script using the project's DATABASE_URL) to bypass the interactive prompt.
- Route-level role guards: stylists/services/reports/settings pages redirect non-admins via `if (facilityUser.role !== 'admin') redirect('/dashboard')` in the server page component.

### File Structure Conventions
- Server components in page.tsx, client logic in [name]-client.tsx
- Shared utilities in src/lib/utils.ts
- All types in src/types/index.ts
- DB queries scoped via src/lib/get-facility-id.ts

## Reference Files
- docs/master-spec.md — full architecture reference
- src/db/schema.ts — source of truth for DB tables
- src/lib/get-facility-id.ts — how facility scoping works

## End of Every Session
ALWAYS do these three things before finishing any task:
1. Update docs/master-spec.md — add any new DB columns, tables,
   API routes, or features built this session
2. Update docs/design-system.md — add any new UI patterns or
   anti-patterns discovered
3. Update CLAUDE.md — add any new rules or bugs fixed that
   should never happen again

This keeps the brain of the project always current.
