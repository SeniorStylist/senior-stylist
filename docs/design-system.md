# Senior Stylist — Design System

Extracted from the codebase. These are the actual patterns in use — not aspirational.

---

## 1. Design Tokens

All tokens are CSS custom properties declared in `src/app/globals.css`.

### Colors

| Token | Value | Usage |
|---|---|---|
| `--color-bg` | `#F7F6F2` | Page background (warm off-white) |
| `--color-sidebar` | `#0D2B2E` | Sidebar background (dark teal) |
| `--color-primary` | `#0D7377` | Buttons, active states, focus rings |
| `--color-primary-light` | `#14D9C4` | Active nav icon color |
| `--color-card` | `#FFFFFF` | Card backgrounds |
| `--color-border` | `#E7E5E4` | Default borders |
| `--color-text` | `#1C1917` | Primary text |
| `--color-text-secondary` | `#57534E` | Secondary text |
| `--color-text-muted` | `#78716C` | Muted/placeholder text |

Tailwind `stone` scale is used throughout (`stone-50` through `stone-900`). The design tokens above map to Tailwind equivalents for consistency.

Hover state for primary: `#0a5f63` (hardcoded inline, no token).

### Service Color Palette

Services get assigned colors from this 12-color palette (cycled by category):

```ts
const PALETTE = [
  '#0D7377', '#7C3AED', '#DC2626', '#DB2777',
  '#D97706', '#059669', '#2563EB', '#0891B2',
  '#9333EA', '#EA580C', '#16A34A', '#0284C7'
]
```

Colors are stored in the `services.color` DB column and rendered as small `w-2.5 h-2.5 rounded-full` swatches on the services list.

---

## 2. Typography

### Fonts

| Font | Usage | How applied |
|---|---|---|
| DM Serif Display | Page headings (`h1`) | Inline style: `style={{ fontFamily: "'DM Serif Display', serif" }}` |
| DM Sans | All body text, UI labels | Default (loaded via layout.tsx) |

### Heading Pattern

All page-level headings follow this exact pattern:

```tsx
<h1
  className="text-2xl font-bold text-stone-900"
  style={{ fontFamily: "'DM Serif Display', serif" }}
>
  Page Title
</h1>
<p className="text-sm text-stone-500 mt-0.5">
  Subtitle or count
</p>
```

### Text Scale

| Class | Usage |
|---|---|
| `text-2xl font-bold text-stone-900` | Page headings |
| `text-base md:text-lg font-bold text-stone-900` | Dashboard header |
| `text-sm font-semibold text-stone-700` | Section labels, form labels |
| `text-sm font-medium text-stone-900` | Primary cell content (names) |
| `text-sm font-semibold text-stone-700` | Monetary values |
| `text-sm text-stone-500` | Secondary cell content |
| `text-xs font-semibold text-stone-500 uppercase tracking-wide` | Table column headers |
| `text-xs text-stone-400` | Subtitles, helper text |
| `text-xs text-red-600` | Inline form errors |

---

## 3. Components

### Button (`src/components/ui/button.tsx`)

Base: `inline-flex items-center justify-center gap-2 font-semibold rounded-xl transition-all duration-150 active:scale-95 disabled:opacity-60`

| Variant | Classes |
|---|---|
| `primary` (default) | `bg-[#0D7377] text-white hover:bg-[#0a5f63]` |
| `secondary` | `bg-stone-100 text-stone-700 hover:bg-stone-200` |
| `ghost` | `bg-transparent text-stone-600 hover:bg-stone-100` |
| `danger` | `bg-red-50 text-red-700 border border-red-200 hover:bg-red-100` |

| Size | Classes |
|---|---|
| `sm` | `text-xs px-3 py-1.5` |
| `md` (default) | `text-sm px-4 py-2.5` |
| `lg` | `text-sm px-5 py-3` |

The `loading` prop replaces content with a spinner and disables the button.

Icon-only add buttons use a fixed `w-9 h-9` square with `shrink-0`:
```tsx
<button className="w-9 h-9 shrink-0 flex items-center justify-center bg-[#0D7377] text-white rounded-xl hover:bg-[#0a5f63] active:scale-95 transition-all">
```

### Card (`src/components/ui/card.tsx`)

```tsx
// Static
<div className="bg-white rounded-2xl border border-stone-100 shadow-sm">

// Clickable
<div className="bg-white rounded-2xl border border-stone-100 shadow-sm hover:border-stone-200 hover:shadow-md transition-all duration-150 cursor-pointer">
```

Padding is added inside by the consumer, not by the card component itself.

### Modal (`src/components/ui/modal.tsx`)

Desktop only. Structure:
- Overlay: `fixed inset-0 z-50 flex items-start justify-center p-4 pt-16` — `items-start` + `pt-16` (64px) keeps the top of the panel below browser chrome. Do NOT use `items-center` (centers vertically, cuts off top fields behind URL/bookmark bar on tall forms).
- Panel: `bg-white rounded-2xl max-h-[calc(100dvh-5rem)] overflow-y-auto` — panel scrolls; `sticky bottom-0` footer inside works correctly (sticks to bottom of panel scroll container). `mb-8` prevents the panel from touching the bottom of the viewport.
- Enter animation: `animate-in fade-in slide-in-from-bottom-3 duration-200`
- Escape key closes; body `overflow: hidden` while open

### Bottom Sheet (`src/components/ui/bottom-sheet.tsx`)

Mobile only. All layout uses **inline styles** (no Tailwind). Key properties:

```ts
// Container
position: 'fixed', inset: 0, zIndex: 50
backgroundColor: 'rgba(0,0,0,0.4)'

// Panel
maxHeight: '92dvh'
borderRadius: '20px 20px 0 0'
paddingBottom: 'env(safe-area-inset-bottom)'

// Entry animation
transform: 'translateY(0)'
transition: 'transform cubic-bezier(0.34, 1.56, 0.64, 1) 380ms'  // spring

// Drag-to-dismiss threshold: 80px
```

Footer/save buttons must be **outside** the scroll area with `flexShrink: 0`. The scrollable body uses `WebkitOverflowScrolling: 'touch'` and `overscrollBehavior: 'contain'`.

**Structural invariant:** drag handle (44px, `flexShrink: 0`), optional title header (`flexShrink: 0`, `borderBottom`), scroll area (`flex: 1, overflowY: auto, minHeight: 0`), and footer (`flexShrink: 0`) are **flex siblings inside the sheet panel** — NOT overlay / `position: fixed` / `position: sticky` children on top of the scroll area. The first child of `children` renders immediately below the header. Never add a second header layer inside the sheet content.

**Mobile-mode detection:** `useIsMobile()` (`src/hooks/use-is-mobile.ts`) is **lazy-initialized** from `window.innerWidth < 768` when `window` is defined (falls back to `false` during SSR). Components that conditionally render Modal vs BottomSheet (e.g. `booking-modal.tsx`) must rely on this lazy init to avoid a first-paint Modal flash on iPhone. Any code that depends on the correct platform DOM before paint (e.g. scroll-reset effects) should use `useLayoutEffect` with `isMobile` in its dep list so it re-runs after a late detection flip.

### Badge (`src/components/ui/badge.tsx`)

Base: `inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold`

| Variant | Background / Text |
|---|---|
| `default` | `bg-stone-100 text-stone-600` |
| `success` | `bg-teal-50 text-teal-700` |
| `warning` | `bg-amber-50 text-amber-700` |
| `danger` | `bg-red-50 text-red-700` |
| `info` | `bg-blue-50 text-blue-700` |

`StatusBadge` maps booking statuses (`confirmed`, `completed`, `cancelled`, `no_show`, `pending`) to badge variants automatically.

**POA notification status badge** (inline, not using Badge component, shown in resident detail display mode next to POA email):
- Enabled: `bg-emerald-50 text-emerald-700 text-xs px-2 py-0.5 rounded-full font-medium` — "Confirmations on"
- Disabled: `bg-stone-100 text-stone-500 text-xs px-2 py-0.5 rounded-full font-medium` — "Confirmations off"

**Pricing type badges** (inline, not using Badge component):
- `text-[10px] font-medium text-stone-400 uppercase tracking-wide` on services list (subtle)
- `text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md` on import preview:
  - Addon: `bg-amber-50 text-amber-700`
  - Tiered: `bg-purple-50 text-purple-700`
  - Options: `bg-blue-50 text-blue-700`

**Pricing UI in booking modal:**
- Addon: checkbox below service select — `"Add-on (+$10.00)"` with `bg-stone-50 border rounded-xl` styling
- Tiered: **stepper row** (NOT a number input) — `rounded-xl border border-stone-200 overflow-hidden bg-stone-50 self-start flex items-center`. Left button (−): `h-11 w-11 text-stone-600 hover:bg-stone-100 border-r border-stone-200`. Right button (+): `h-11 w-11 text-white bg-[#0D7377] hover:bg-[#0a5f63] border-l border-stone-200`. Count display: `w-14 text-center text-base font-semibold select-none`. Below the stepper, a tier hint: `{minQty}–{maxQty >= 999 ? minQty + '+' : maxQty}: $X each → $total` in `text-xs text-stone-500`.
- Multi-option: `<select>` dropdown showing `"OptionName — $XX.00"` per option, pre-selects first
- Price display uses `resolvePrice()` from `src/lib/pricing.ts` for real-time preview
- **Addon price display**: `formatPricingLabel()` returns `+$X.00` for addon (e.g. `+$15.00`) using `(addonAmountCents ?? priceCents)`. Do NOT use `addonAmountCents ?? 0` alone anywhere — manually created addon services may store the surcharge in `priceCents`.
- **Category sub-label**: services list shows `<p className="text-xs text-stone-400 mt-0.5">{service.category}</p>` under the name when `service.category` is truthy. Category flows from PDF parser → `ParsedService.category` → bulk POST body → DB `services.category` column.

**Multi-service + addon picker (booking modal):**
- Primary services rendered as a list-with-"+ Add another service" button; each row is a service `<select>` with a trash icon (`h-11 w-11`) appearing only when >1 row. First row = the "primary" service; it alone drives `selectedQuantity`/`selectedOption`/`addonChecked`. Duration = sum of all primary `durationMinutes`.
- Labeled divider between primary and addon sections: flex container with two `flex-1 border-t border-stone-200` spans surrounding a centered pill `<span>` reading `"Add-ons (optional)"` (`text-[11px] uppercase tracking-wide text-stone-500`).
- Addon checklist: each row full-width, `min-h-[44px]`, `py-3 px-3`, `rounded-xl border border-stone-200`. Checkbox `h-6 w-6 accent-[#0D7377] shrink-0`. Service name left-aligned, `+$X.XX` right-aligned in `text-stone-500`.
- Footer (outside the scroll area, `flexShrink: 0`) holds a breakdown (one line per primary + one per addon + bold Total + Duration row) followed by the Book button. Mobile inline style: `style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}`.
- **Breakdown annotations**: primary service name (idx===0) is context-aware via IIFE — tiered: `ServiceName (qty × $X/ea)`, multi_option: `ServiceName — OptionName`, plain addon: `ServiceName (+$X add-on)`. Addon checklist lines in breakdown use `text-amber-700` (not `text-stone-500`).
- All interactive elements ≥44px tap targets.

**Pricing UI in services page:**
- Pricing type `<select>` dropdown in add/edit forms (Fixed / Add-on / Tiered / Multiple Options)
- Conditional fields: addon amount input, dynamic tier rows (min–max × price), dynamic option rows (name + price)
- Price column shows `formatPricingLabel()` output — range for multi_option, "+addon" for addon, "/unit" for tiered

### Avatar (`src/components/ui/avatar.tsx`)

Initials-only (no image upload). Renders up to 2 initials from the name.

```tsx
// With service color
<Avatar name="Jane Doe" color="#0D7377" />
// Renders: bg rgba(#0D7377, 12%) with text color #0D7377

// Without color
<Avatar name="Jane Doe" />
// Renders: bg-teal-50 text-teal-700
```

| Size | Classes |
|---|---|
| `sm` | `w-7 h-7 text-[10px]` |
| `md` (default) | `w-9 h-9 text-xs` |
| `lg` | `w-11 h-11 text-sm` |

---

## 4. Layout & Navigation

### Page Structure

```
┌─────────────────────────────────────────┐
│  Sidebar (220px, desktop only)          │
│  ┌───────────────────────────────────┐  │
│  │  Main content (.main-content)     │  │
│  │  p-6 max-w-4xl mx-auto           │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

On mobile the sidebar is replaced by a bottom navigation bar. `.main-content` includes `paddingBottom: 'calc(env(safe-area-inset-bottom) + 72px)'` to clear the mobile nav.

### Sidebar (`src/components/layout/sidebar.tsx`)

- Width: `w-[220px]`
- Background: `var(--color-sidebar)` → `#0D2B2E`
- Active nav item: `bg-white/15 text-white` + icon `text-[#14D9C4]`
- Inactive nav item: `text-white/60 hover:bg-white/10 hover:text-white`
- Facility switcher uses inline styles
- Viewer role gets a "View Only" badge in the nav

### Dashboard Layout

The dashboard (`dashboard-client.tsx`) uses a split layout:

```
flex h-screen overflow-hidden
├── Calendar column (flex-1, p-3 md:p-4)
│   ├── Header (title + view switcher)
│   └── Calendar card (flex-1, rounded-2xl)
└── Right panel (w-[300px], hidden on mobile)
    ├── Tabs (Residents / Services / Stylists)
    ├── Panel content (flex-1, overflow-hidden)
    └── Stats footer (border-t, bg-stone-50)
```

View switcher buttons use the active pattern `bg-[#0D7377] text-white` vs `text-stone-600 hover:bg-stone-100`.

---

## 5. Forms & Inputs

All inputs use the same base pattern. Background transitions from `stone-50` to `white` on focus.

### Text Input

```tsx
<input className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#0D7377] focus:ring-2 focus:ring-teal-100 transition-all" />
```

### Search Input

Adds `shadow-sm` and uses white background by default:

```tsx
<input className="w-full bg-white border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm placeholder:text-stone-400 focus:outline-none focus:border-[#0D7377] focus:ring-2 focus:ring-teal-100 transition-all shadow-sm" />
```

### Select

```tsx
<select className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0D7377] transition-all" />
```

### Category Grouping in Native Selects

Long service pickers group options by `service.category` via `<optgroup>`. A small helper produces `Array<[string, T[]]>` keyed on `category?.trim() || 'Other'`, sorted alphabetical with "Other" last. Skip the grouping wrapper when `groups.length <= 1` — a single-group `<optgroup>` adds visual noise without segmentation value.

```tsx
<select>
  <option value="">Select a service</option>
  {(() => {
    const groups = groupByCategory(options)
    if (groups.length <= 1) return options.map(s => <option key={s.id} value={s.id}>{label(s)}</option>)
    return groups.map(([category, list]) => (
      <optgroup key={category} label={category}>
        {list.map(s => <option key={s.id} value={s.id}>{label(s)}</option>)}
      </optgroup>
    ))
  })()}
</select>
```

### Price Input

Uses a `$` prefix character absolutely positioned inside a relative wrapper:

```tsx
<div className="flex-1 relative">
  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400 text-sm">$</span>
  <input type="number" step="0.01" className="... pl-7 ..." />
</div>
```

### Inline Form Panels

Add/edit forms appear inline (not in modals) as `bg-white rounded-2xl border border-stone-100 shadow-sm p-4 mb-4 space-y-3` cards with a `text-sm font-semibold text-stone-700` label at the top.

---

## 6. Data Tables & Lists

All data tables share the same structure using CSS Grid `grid-cols-12`.

### Container

```tsx
<div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
```

### Header Row

```tsx
<div className="grid grid-cols-12 gap-4 px-5 py-2.5 border-b border-stone-100 bg-stone-50">
  <div className="col-span-N text-xs font-semibold text-stone-500 uppercase tracking-wide">Column</div>
</div>
```

### Data Row

```tsx
<div className="grid grid-cols-12 gap-4 items-center px-5 py-3.5 border-b border-stone-50 last:border-0">
```

Clickable rows use `<button>` with `hover:bg-stone-50 transition-colors` and a `text-stone-300` chevron at the end.

### Row Hover Actions

Edit/archive icons appear only on `onMouseEnter` via a `hoverId` state — not shown by default. The confirm-archive pattern:
1. First click: shows "Archive? Yes / No" inline
2. Second click on "Yes": executes the action
3. Mouse leave cancels the confirm state

### Inline Edit Row

Active edit row gets `bg-teal-50/60` background and a `border-l-2 border-[#0D7377]` left accent:

```tsx
<div className="px-5 py-3 bg-teal-50/60 border-l-2 border-[#0D7377]">
```

### Service Color Swatch

```tsx
<div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: service.color ?? '#0D7377' }} />
```

### Category Header Rows (Import Preview)

Interleaved non-interactive category headers in grouped lists:

```tsx
<div className="grid grid-cols-12 gap-2 px-4 py-1.5 bg-stone-50 border-b border-stone-100 items-center">
  <div className="col-span-12 flex items-center gap-2">
    <div className="w-1 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
    <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide">{name}</span>
  </div>
</div>
```

### Category Section Headers (Services Page List)

Same concept, simpler markup — used on the main services list. Built via an IIFE that sorts services by `category` then pushes a header `<div>` each time the category changes into a `ReactNode[]`. Sort forces "Other" last via a `|| 'zzzOther'` sort key.

```tsx
<div
  key={`cat-${cat}`}
  className="px-5 pt-4 pb-1.5 bg-stone-50/50 border-b border-stone-100 text-[11px] font-semibold text-stone-500 uppercase tracking-wide"
>
  {cat}
</div>
```

---

## 7. Patterns

### Empty States

Consistent pattern across all list pages:

```tsx
<div className="bg-white rounded-2xl border border-stone-100 shadow-sm py-16 text-center">
  <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-3">
    <svg ... stroke="#A8A29E" strokeWidth="1.8"> {/* contextual icon */} </svg>
  </div>
  <p className="text-sm font-semibold text-stone-700">No X yet</p>
  <p className="text-xs text-stone-400 mt-1 mb-4">Helper text.</p>
  <button className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#0D7377] text-white text-sm font-semibold rounded-xl hover:bg-[#0a5f63] active:scale-95 transition-all">
    Add X
  </button>
</div>
```

Icon stroke color is always `#A8A29E` (stone-400 equivalent) for empty state icons.

### Loading / Skeleton

Skeleton components (e.g. `SkeletonResidentRow`) use the `shimmer` animation from globals.css. The pull-to-refresh indicator uses a spinning refresh SVG with `stroke="#0D7377"`.

### Multi-step modal in-progress loading overlay

When a long async operation replaces step content (e.g. OCR scanning in `ocr-import-modal.tsx`), replace the step body with a centered overlay — same outer container dimensions. Pattern:

```tsx
{step === 'upload' && (scanning ? (() => {
  // parse progress
  return (
    <div className="px-5 py-8 flex flex-col items-center justify-center gap-6" style={{ minHeight: '280px' }}>
      <svg ... className="animate-pulse">...</svg>  {/* teal icon */}
      <p style={{ opacity: tipVisible ? 1 : 0 }} className="transition-opacity duration-300">{SCAN_TIPS[tipIndex]}</p>
      <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden w-full max-w-xs">
        <div className="h-full bg-[#0D7377] rounded-full transition-all duration-700" style={{ width: `${progressPct}%` }} />
      </div>
    </div>
  )
})() : (
  <div ...>normal step content</div>
))}
```

Tip rotation: `useEffect` keyed on the `scanning` flag; 3s interval fades out (`tipVisible=false`) → 400ms delay increments index → fades in. Progress bar: regex parse the progress string → `(X/Y)*100` capped at 90, default 5 when empty.

### OCR review service fields — `<select>` with fuzzy pre-select

Service fields in the OCR review step (`ocr-import-modal.tsx`) use `<select>` dropdowns (NOT free-text inputs) so users always pick from existing services. Pattern:

- Options: existing services grouped by category (`<optgroup>`), price shown via `formatCents(s.priceCents)`. When only 1 category, flat list (no optgroups).
- `__new__${name}` value at bottom: shown when `!entry.serviceId && entry.serviceName`. Selecting it keeps `serviceId = null` so the import route creates a new service.
- Pre-selection at load time via two-signal IIFE in `buildSheetState`: (1) `fuzzyBestMatch(nonAddonServices, name)` for name score, (2) `nonAddonServices.filter(s => s.priceCents === ocrPrice)` for exact price match. If unique price match and nameScore < 0.85, price wins. If name match found, trust it (price mismatch = add-ons bundled in total). If no name match, fall back to unique price match. Add-on rows use full `services` list (name-only).
- `fuzzyScore(a,b)`: 1.0 for exact, 0.85 for substring containment, else word-set overlap ratio (using `normalizeWords`). `fuzzyBestMatch` scans all items and returns the highest scorer above threshold.
- Same `<select>` pattern for add-on service rows.
- **Price field**: read-only intent — `onChange` only updates `priceCents`, never `serviceId`/`serviceName`. Shows `"from sheet"` hint (`text-[10px] text-stone-400`) below the input to indicate it came from the handwritten log.

### Toast Notifications

```tsx
const { toast } = useToast()
toast('Changes saved', 'success')
toast('Error message', 'error')
```

### Floating Action Bar (Multi-Select)

When one or more rows are selected, a dark pill appears pinned to `bottom-6 left-1/2 -translate-x-1/2`:

```tsx
<div
  className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl z-40 animate-in fade-in slide-in-from-bottom-3 duration-200"
  style={{ backgroundColor: '#0D2B2E', minWidth: 'max-content' }}
>
```

- Use `z-40` (not z-50) so it does not cover the mobile nav bar.
- Color picker popup opens `bottom-full mb-2` above the bar to avoid clipping.
- Inline color swatches use the service PALETTE (12 colors).

### Duplicate Resolution Modal

When importing services that already exist, a modal interrupts before the import runs. Per-row "Replace | Skip" toggles with global "Replace All / Skip All" shortcuts. Active toggle is highlighted with `bg-[#0D7377] text-white` (replace) or `bg-stone-700 text-white` (skip). Follows the standard modal pattern (overlay blur, `max-w-lg`, `animate-in fade-in slide-in-from-bottom-3`).

### Indeterminate Checkbox

React does not support `indeterminate` as a JSX prop. Set it imperatively via a callback ref:

```tsx
ref={(el) => {
  if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < total
}}
```

### Async Submit Double-Fire Guard

`useState` for `submitting` does NOT prevent concurrent calls — `setSubmitting(true)` is batched and the component doesn't re-render (disable the button) until the next tick. Rapid double-tap on mobile or simultaneous Cmd+Enter + click slips through.

Pattern for any async submit handler:
```tsx
const submittingRef = useRef(false)

const handleSubmit = async () => {
  if (submittingRef.current) return  // synchronous — immune to batching
  submittingRef.current = true
  setSubmitting(true)   // drives loading/disabled UI
  try { ... }
  finally {
    submittingRef.current = false
    setSubmitting(false)
  }
}
```

### Destructive Confirmation

Never use `window.confirm()`. Always use inline two-step confirm:
1. First action click: set `confirmXId = id`
2. Render "X? Yes / No" buttons inline in the row
3. Mouse leave resets `confirmXId`
4. "Yes" click: execute + clear state

### Role-Gated UI

Admin-only features are hidden via `isAdmin` prop:
```tsx
{isAdmin && <div>Admin-only content</div>}
```
Stylist role shows calendar + log only. No conditional rendering based on `role === 'viewer'` — viewer gets the same read UI; all mutation actions simply fail the server-side role check.

### Settings — Team Tab

Each user row shows: avatar initials → name/email → role badge → linked stylist name (if any) → status badge → Remove button.

- **Role badge**: teal pill for admin, stone pill for others
- **Linked stylist** (`↔ StylistName`): shown in `text-xs text-stone-400 hidden sm:inline` when `cu.stylistName` is set. Resolved server-side via batch `inArray` query in page.tsx; passed as `stylistName: string | null` on `ConnectedUser`.
- **Status badges**: Active (emerald, last sign-in < 90 days), Invited (amber, never signed in), Inactive (stone, > 90 days)
- **Remove flow**: two-step inline confirm; mouse leave cancels confirm state; optimistic `localUsers` removal; emerald toast "Access removed" for 3 s

### Settings — Invites Tab

- **Send Invite**: form with email + role select + "Send Invite" button
- **Success messages**: "Invite sent!" for new invites; "Invite refreshed and resent" when the API returns `{ refreshed: true }` (pending invite already existed — token was refreshed and email resent). Both auto-clear after 3 s.
- **Error messages**: inline red text; includes "This person already has access to this facility" (409) when the invited email already has a `used=true` invite.
- **Pending list**: shows role badge + Expired badge + Resend / Copy link / Revoke buttons per invite

### Inline Create in Combobox

Used in booking-modal.tsx (resident field) and log-client.tsx walk-in form. Pattern:

- When search length ≥ 3 and no match exists: show a single "+ Create 'name'" button (teal, 44px min-height) inside the dropdown
- When search length ≥ 3 and partial matches exist: show matching rows + "+ Create 'name'" at the bottom separated by a `border-t border-stone-100`
- Tapping "+ Create" replaces the dropdown content with an inline mini-form (name pre-filled, room optional, Cancel / Create & Select buttons)
- On success: push to `localNewResidents: Resident[]` → auto-select → close dropdown
- State: `localNewResidents`, `createResidentOpen`, `createResidentName`, `createResidentRoom`, `creatingResident`, `createResidentError`
- 409 error → "A resident with this name already exists"
- All buttons inside the dropdown use `onMouseDown` (not `onClick`) to beat the 150ms `onBlur` close timeout
- All create state resets on modal/form close

### Animations

| Name | Trigger | Duration |
|---|---|---|
| `active:scale-95` | Any interactive button | 150ms |
| `animate-in fade-in slide-in-from-bottom-3` | Modal entry | 200ms |
| Bottom sheet spring | Sheet open/close | `cubic-bezier(0.34, 1.56, 0.64, 1) 380ms` |
| `fab-bounce` | Quick Book FAB on mount | CSS keyframe |
| `calendar-booking-flash` | Calendar on booking save | 750ms flash via state |
| `log-fade-up` | Activity log entries | CSS keyframe |

### Data Conventions

- **Prices**: always `integer` cents in DB (`price_cents`). Display via `formatCents(cents)` from `src/lib/utils.ts`. Never store floats.
- **Soft delete**: `active = false` — never hard delete anything.
- **Facility scope**: every DB query is scoped to `facilityId` via `getUserFacility()`.
- **Duration**: `duration_minutes` integer, default 30. UI options: 15, 30, 45, 60, 75, 90, 120.
- **Dates**: stored as ISO strings; formatted via `formatDate()` from `src/lib/utils.ts`.

### Database Schema Reference

**`facilities`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK, gen_random_uuid() |
| `name` | text | required |
| `address` | text | optional |
| `phone` | text | optional |
| `calendar_id` | text | Google Calendar ID |
| `timezone` | text | default 'America/New_York' |
| `payment_type` | text | default 'facility' |
| `working_hours` | jsonb | `{ days: string[], startTime: "HH:MM", endTime: "HH:MM" }` — null = 08:00–18:00 default; bounds booking time slots |
| `contact_email` | text | optional — mailto fallback on /unauthorized; falls back to first admin's email |
| `active` | boolean | soft delete flag |

**`services`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `facility_id` | uuid | FK, required — all queries scoped here |
| `name` | text | required |
| `description` | text | optional |
| `price_cents` | integer | required, no floats — for multi_option type, set to first option's price as fallback |
| `duration_minutes` | integer | default 30 |
| `color` | text | hex color, optional |
| `pricing_type` | text | NOT NULL, default `'fixed'` — `fixed` \| `addon` \| `tiered` \| `multi_option` |
| `addon_amount_cents` | integer | nullable — surcharge amount for addon type |
| `pricing_tiers` | jsonb | nullable — `[{ minQty, maxQty, unitPriceCents }]` for tiered type |
| `pricing_options` | jsonb | nullable — `[{ name, priceCents }]` for multi_option type |
| `active` | boolean | soft delete flag |

---

## 8. Phase 16+ Patterns

### Navigation Progress Bar

`src/components/ui/navigation-progress.tsx` — a 2px teal bar that appears at the top of the viewport on route change.

- Uses `usePathname()` to detect navigation
- Shows on route change; auto-hides after completion
- Imported in `(protected)/layout.tsx` so it appears on all authenticated pages
- Color: `#0D7377` (teal primary)
- Height: `2px`, `z-50`, `position: fixed, top: 0`

### Collapsible Log Sections

The log page (`/log`) groups bookings by stylist. Each stylist's section is independently collapsible.

```tsx
// State keyed by stylistId
const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

// Toggle
const toggle = (id: string) =>
  setCollapsed(prev => ({ ...prev, [id]: !prev[id] }))

// Section header chevron rotates on collapse
<ChevronDown
  style={{ transform: collapsed[id] ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 200ms' }}
/>
```

### Stylist Mobile Today-List View

On mobile when `role === 'stylist'`, the dashboard replaces FullCalendar with a flat list of today's appointments.

- Detected via `useEffect`: `if (isMobile && role === 'stylist') setStylistListMode(true)`
- Uses the same `fetchBookings` data as the calendar view
- Each row has a one-tap **Mark Done** button (calls `PUT /api/bookings/[id]` with `status: 'completed'`)
- No calendar rendering on mobile for stylists — avoids FullCalendar complexity

### Portal Service Picker Cards

Service selection in `portal-client.tsx` uses full-width tap cards instead of a native `<select>`. Selected state: `border-[#0D7377] bg-teal-50` + checkmark SVG. Unselected: `border-stone-200 bg-white hover:border-stone-300`. Color swatch: `w-2.5 h-2.5 rounded-full` inline style from `service.color`. Category headers: `text-xs font-semibold text-stone-500 uppercase tracking-wide`. Live price breakdown card uses `bg-stone-50 rounded-xl px-4 py-3` with amber `text-amber-700` rows for add-ons. `groupByCategory()` is defined inline (cannot import from booking-modal); identical logic to the booking modal version.

### Teal Info Banner (POA Portal)

Used on `/portal/[token]` when `poaName` is set, to indicate the visitor is a Power of Attorney booking on behalf of a resident.

```tsx
{poaName && (
  <div className="bg-teal-50 border border-teal-100 rounded-xl px-4 py-2.5 text-sm text-teal-800">
    Booking on behalf of <strong>{residentName}</strong>
    {poaEmail && <span className="text-teal-600 ml-1">({poaEmail})</span>}
  </div>
)}
```

Placed between the resident header card and the Book button.

### Amber Banner (Pending Requests)

Dashboard shows an amber banner when there are pending access requests assigned to the facility.

```tsx
{pendingCount > 0 && (
  <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
    <span className="text-amber-700 text-sm font-medium">
      {pendingCount} pending access request{pendingCount > 1 ? 's' : ''}
    </span>
    <a href="/settings?tab=requests" className="text-amber-700 underline text-sm">Review</a>
  </div>
)}
```

- Color: `bg-amber-50 border-amber-200 text-amber-700`
- Links to Settings → Requests tab
- Admin-only (not shown to stylists/viewers)

### Tab Navigation (Segmented Control)

Used in the `/super-admin` page to switch between Facilities, Franchises, Requests, and Reports sections.

```tsx
// Container
<div className="flex gap-1 bg-white rounded-xl border border-stone-200 p-1 mb-6">
  {tabs.map((tab) => (
    <button
      key={tab}
      onClick={() => setActiveTab(tab)}
      className={cn(
        'flex-1 py-1.5 text-xs font-semibold rounded-lg capitalize transition-all',
        activeTab === tab
          ? 'bg-[#0D7377] text-white'
          : 'text-stone-600 hover:bg-stone-100'
      )}
    >
      {tab}
    </button>
  ))}
</div>
```

- Container: `bg-white rounded-xl border border-stone-200 p-1`
- Active pill: `bg-[#0D7377] text-white rounded-lg`
- Inactive: `text-stone-600 hover:bg-stone-100 rounded-lg`
- Each tab wraps its section content in `{activeTab === 'tab' && <...>}` — no animation needed
- Badge counts (e.g. `Requests (3)`) inline in the button label when `count > 0`

### Invite Accept Page (`/invite/accept`)

Self-contained auth page for unauthenticated invitees. Server + client component split.

- Same card pattern as login page: `bg-white rounded-2xl shadow-xl border border-stone-100 p-10 w-full max-w-sm text-center`
- Logo + DM Serif Display heading: "Join [Facility Name]"
- Subtitle: "You've been invited as a [role]"
- Primary action: email input (pre-filled with invite email) + teal "Send magic link" button
- Divider: `flex items-center gap-3` with `h-px bg-stone-200` lines and "or" text
- Secondary: Google OAuth button (same style as login page)
- "Check your email" state: teal checkmark icon in `#e6faf9` background, "Use a different email" ghost button
- Mobile-first layout with `px-4` page padding

### Access Request Form (`/unauthorized`)

Public page for users who have no facility access. Collects name + role only — no facility picker.

```tsx
// State
const [fullName, setFullName] = useState('')
const [role, setRole] = useState<'stylist' | 'viewer'>('stylist')

// Submit — always visible, no facilityId gate
const res = await fetch('/api/access-requests', {
  method: 'POST',
  body: JSON.stringify({ email: userEmail, fullName, userId, role }),
})
```

- Page is `'use client'` — fetches auth user via `createClient()` from `@/lib/supabase/client` (not server)
- Title: `'Request access'` (no facility name)
- On success: sets `pageState = 'submitted'` and shows confirmation message
- `facilityId` is NOT sent — it's `null` in the DB until super admin assigns it

---

## Upcoming UI patterns (Phases 7–14)

### Compliance badge (Phase 7)
Three-state colored dot/badge on stylist list rows:
- **Green** — all required documents verified and not expiring within 30 days
- **Amber** — at least one document expires within 60 days, or unverified
- **Red** — at least one document expired or missing

Use inline SVG dot (`w-2 h-2 rounded-full`) with `bg-emerald-500` / `bg-amber-400` / `bg-red-500`. Never use Tailwind `text-` color classes for status dots — always `bg-` to ensure color-blind distinction.

### Coverage request status chips (Phase 8)
Reuse the existing `Badge` component: `open` → amber, `filled` → emerald, `cancelled` → stone.

### Region hierarchy breadcrumb (Phase 9)
`Master Admin > Franchise Name > Region Name > Facility Name` — render as `text-xs text-stone-400` with `›` separators. Clickable segments navigate to the respective admin view.

### Payroll entry card (Phase 10)
White card, stone border, two-column layout: left = stylist name + period, right = pay amounts stacked. "Approved" state: emerald left border + lock icon. Use `formatCents()` for all money values.

### Issue severity colors (Phase 11)
- `low` — stone-500 text, no badge background
- `medium` — amber-600 text, `bg-amber-50` badge
- `high` — red-600 text, `bg-red-50` badge + triggers dashboard red banner (same pattern as existing amber pending-requests banner)

### QB sync status (Phase 14)
Synced: `text-emerald-600` with checkmark. Failed: `text-red-600` with exclamation + retry button. Pending: `text-stone-400` with spinner. All using existing icon SVG patterns.
