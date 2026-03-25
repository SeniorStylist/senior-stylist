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
- facilities.working_hours is jsonb `{ days: string[], startTime: "HH:MM", endTime: "HH:MM" }` — null = default 08:00–18:00; use it to bound time slots in booking modal
- ALL tables MUST have RLS enabled with a `service_role_all` policy — when adding a new table, run `ALTER TABLE x ENABLE ROW LEVEL SECURITY` and `CREATE POLICY "service_role_all" ON x FOR ALL TO service_role USING (true) WITH CHECK (true)`
- NEVER disable RLS on any table — all DB access goes through service_role (Drizzle + SUPABASE_SERVICE_ROLE_KEY); the anon key is auth-only and must never have direct table access

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
- PWA icons: use `src/app/icon.tsx` + `apple-icon.tsx` with ImageResponse from `next/og` — never use @napi-rs/canvas
- Recurring bookings: self-referential FK `recurringParentId` in schema requires `(): AnyPgColumn => bookings.id` pattern
- date-fns is installed (`addWeeks`, `addDays`, `addMonths`) — use it for date arithmetic
- InstallBanner uses `beforeinstallprompt` (Android) + manual iOS Share instructions; checks `(display-mode: standalone)` to hide when already installed
- drizzle-kit push will interactively prompt when it detects constraints that already exist in the DB — if it hangs, add the columns directly via the postgres driver (node script using the project's DATABASE_URL) to bypass the interactive prompt.
- Route-level role guards: stylists/services/reports/settings pages redirect non-admins via `if (facilityUser.role !== 'admin') redirect('/dashboard')` in the server page component.
- NEVER put redirect() calls inside try/catch in Next.js page components — Next.js redirect() throws a special NEXT_REDIRECT error internally, and a catch block swallows it, causing the error UI to render instead of the redirect. Always perform auth/facility checks and their redirects OUTSIDE try/catch; only wrap DB data loading in try/catch.
- Next.js 16 dynamic route params are a Promise — ALWAYS use `{ params }: { params: Promise<{ id: string }> }` and `const { id } = await params` inside the handler. The old sync pattern `{ params: { id: string } }` causes a build error.
- Super admin facility mutations: use PUT /api/super-admin/facility/[id] (not the regular /api/facility route) — it verifies NEXT_PUBLIC_SUPER_ADMIN_EMAIL and accepts `active` boolean for deactivation.
- Facility name uniqueness checks MUST include `eq(t.active, true)` — inactive/deactivated facilities should not block name reuse.
- Hard delete facilities via DELETE /api/super-admin/facility/[id] — only allowed if no bookings exist (returns 409 otherwise). Delete facility_users FK rows first, then the facility row.
- Middleware /onboarding bypass: invited users with no facilityUser record must be allowed through to /onboarding — add `!pathname.startsWith('/onboarding')` to the unauthorized redirect condition.
- Onboarding wizard is 6 steps (type Step = 1 | 2 | 3 | 4 | 5 | 6); progress = (step / 6) * 100. Step 4 = Services (choose/manual/import), Step 5 = Residents (choose/manual/import), Step 6 = Done summary.
- CSV/Excel import in onboarding: use papaparse (CSV) and xlsx (Excel) client-side; detect columns by normalizing headers toLower().replace(/\s+/g,''); snap duration to nearest [15,30,45,60,75,90,120].
- papaparse is already installed (`Papa from 'papaparse'`); xlsx is already installed (`* as XLSX from 'xlsx'`).
- Onboarding Step 5 (Residents) uses /api/residents/bulk (not /api/residents) for CSV/Excel import — POST `{ rows: [{ name, roomNumber? }] }`, returns `{ data: { created: N } }`.
- Stylist dashboard mobile view: when role === 'stylist' && isMobile, show today's appointment list (not FullCalendar). setStylistListMode(true) in useEffect. Uses existing fetchBookings.
- Invite accept auto-link: use `ilike(stylists.name, userFullName)` to match stylist by name — role === 'stylist' redirects to /my-account?welcome=1, others to /dashboard.
- NavigationProgress: client component in src/components/ui/navigation-progress.tsx — uses usePathname to show 2px teal bar on route change. Imported in (protected)/layout.tsx.
- Log page stylist sections are collapsible — collapsed state keyed by stylistId in useState<Record<string, boolean>>({}).

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
