# Senior Stylist — Design System

Extracted from the codebase. These are the actual patterns in use — not aspirational.

---

## 1. Design Tokens

All tokens are CSS custom properties declared in `src/app/globals.css`.

### Colors

| Token | Value | Usage |
|---|---|---|
| `--color-bg` | `#F7F6F2` | App page background (warm off-white) |
| `--color-sidebar` | `#1C0A12` | Sidebar background (very dark burgundy — matches brand) |
| `--color-primary` | `#8B2E4A` | Buttons, active states, focus rings, FullCalendar toolbar |
| `--color-primary-light` | `#C4687A` | Softer rose accent |
| `--color-brand-hover` | `#72253C` | Hover state for primary burgundy |
| `--color-portal-bg` | `#FDF8F8` | Resident portal page background (warm blush) |
| `--color-card` | `#FFFFFF` | Card backgrounds |
| `--color-border` | `#E7E5E4` | Default borders |
| `--color-text` | `#1C1917` | Primary text |
| `--color-text-secondary` | `#57534E` | Secondary text |
| `--color-text-muted` | `#78716C` | Muted/placeholder text |

Tailwind `stone` scale is used throughout (`stone-50` through `stone-900`). The design tokens above map to Tailwind equivalents for consistency.

**Brand palette (from marketing site seniorstylist.com):**
- Primary: `#8B2E4A` (deep burgundy/wine — logo, headings, CTAs)
- Hover: `#72253C` (darker wine)
- Portal background: `#FDF8F8` (warm blush)
- Accent: `#C4687A` (softer rose — secondary elements)

**Full brand migration complete (2026-04-14):** The entire admin app now uses the burgundy palette. `button.tsx`, `input.tsx`, `select.tsx`, `toast.tsx`, booking modal, panels, sidebar active states, and all email templates use `#8B2E4A`. Do NOT add new `#0D7377` teal anywhere — the brand color is burgundy app-wide.

**Logo integration complete (2026-04-14):** Logo image at `/public/Seniorstylistlogo.jpg`. Use `<Image>` from `next/image`. Three placement strategies:
- **Sidebar** (`sidebar.tsx`): wrap in `<Link href="/dashboard">` + `bg-white/95 px-2 py-1.5 rounded-xl` white card so gray scissor detail stays visible on dark `#1C0A12` background
- **Portal header** (`(resident)/layout.tsx`): `style={{ filter: 'brightness(0) invert(1)' }}` on `<Image>` to render all logo colors white on `#8B2E4A` header; wrap in `<a href="https://seniorstylist.com" target="_blank">`
- **White-background pages** (login, invite-accept, unauthorized): show logo naturally, no filter, no wrapper needed

**Exception:** `completed` status badges remain `bg-teal-50 text-teal-700` (semantic color — intentional). User-owned color data (service/stylist color picker palette arrays, DB defaults, calendar event fallbacks) also retain `#0D7377`.

**FullCalendar hover:** `#72253C`; active: `#5c1e2e`; highlight tint: `rgba(139, 46, 74, 0.1)`.

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

**Payroll status badges** (inline, not using Badge component, shown in pay period list + detail header):
- Open: `bg-teal-50 text-teal-700`
- Processing: `bg-amber-50 text-amber-700`
- Paid: `bg-emerald-50 text-emerald-700`
- Pill shape: `inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold`. Once status is `paid`, all inline-edit controls on `/payroll/[id]` disable and deduction mutations 403.

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
- **Facility switcher + "Add facility" link are admin-only (2026-04-25)**: `showSwitcher = allFacilities.length > 1 && role === 'admin'`. The fallback "+ Add facility" link below the logo (single-facility branch) is also gated on `role === 'admin'`. Stylists with multi-facility membership see the current facility name as plain non-interactive text — no dropdown, no add link. Stylists must never see facility-switching UI

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

Long service pickers group options by `service.category` via `<optgroup>`. A small helper produces `Array<[string, T[]]>` keyed on `category?.trim() || 'Other'`. Section order follows the per-facility `facilities.service_category_order` (captured on PDF import) when it exists; when absent or empty, categories fall back to **Z→A descending** alphabetical. "Other" always sorts last. Skip the grouping wrapper when `groups.length <= 1`. Within each group, services are pre-sorted by `pricingTypePriority` (fixed/multi_option = 0, tiered = 1, addon = 2) then alphabetically by name — so standard services appear first, tiered second, add-ons last. All three sort primitives live in `src/lib/service-sort.ts` (`buildCategoryPriority`, `sortCategoryGroups`, `sortServicesWithinCategory`) and are shared by booking modal, portal picker, services page, log walk-in form, and **dashboard Services panel** — no site should re-implement its own category sort.

**Dashboard Services panel** (`src/components/panels/services-panel.tsx`) rules:
- Price display MUST use `formatPricingLabel(service)` from `src/lib/pricing.ts` — never `formatCents(service.priceCents)` directly (returns $0 for addon/tiered/multi_option types)
- Sort order is applied in `dashboard-client.tsx` via a `useMemo` on `localServices` using the same three `service-sort.ts` helpers, respecting `facility.serviceCategoryOrder`; the panel receives an already-sorted list and renders it flat

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

### Expandable Row with Inline Edit (payroll detail)

Pattern: one row per item with `expandedId: string | null` state (see `payroll-detail-client.tsx` + `directory-client.tsx` for the applicant variant). Clicking the row toggles `expandedId`; the expanded body renders below the same row inside the list container (NOT a separate modal). Row grid columns are desktop-only (`md:grid md:grid-cols-[...]`); mobile collapses to stacked rows. Expand chevron rotates via `rotate-90` when active.

Expanded body contains a pay-type selector (`<select>`) with conditional inputs (commission = read-only; hourly = hours + hourly-rate; flat = flat amount), a Deductions sub-section (list + ✕ delete per row + "+ Add Deduction" inline form), a live net-pay preview computed locally via `computeNetPay()`, and a Save button that PUTs and updates local state optimistically. All inputs disable when period `status === 'paid'`.

### Async-operation modal with loading state (pay period create)

For modals whose submit triggers an expensive server op (pay period creation scans months of bookings), show an in-modal loading state replacing the form body:

```tsx
<Modal open={modalOpen} onClose={() => !submitting && setModalOpen(false)} title="New Pay Period">
  {submitting ? (
    <div className="p-8 flex flex-col items-center gap-4">
      <svg className="animate-spin h-8 w-8 text-[#8B2E4A]" .../>
      <div className="text-sm font-medium">Calculating payroll...</div>
      <div className="text-xs text-stone-500 text-center max-w-xs">
        Scanning completed bookings and computing commission for each stylist.
      </div>
    </div>
  ) : (
    // …form…
  )}
</Modal>
```

The `onClose` guard (`!submitting && setModalOpen(false)`) prevents the user closing the modal mid-request. Same conceptual pattern as the OCR `scanning` overlay but lives inside `<Modal>` rather than replacing the whole screen.

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

### Searchable Combobox (FacilityCombobox / ResidentCombobox pattern)

Used when a list is too long for a plain `<select>` and needs typeahead filtering (e.g. facility picker and resident line pickers in `scan-check-modal.tsx`).

**State ownership:** Component owns its own `open: boolean` state internally — parent controls `searchValue`, `selectedId`, and callbacks.

**Blur handling:** `onBlur` on the container `<div>` (via `containerRef`) closes the dropdown when focus leaves entirely. `FacilityCombobox` also clears the input via `onSearchChange('')` if `!selectedId` on blur.

**Click vs blur race:** Use `onMouseDown={(e) => { e.preventDefault(); onSelect(...) }}` on dropdown options — `preventDefault()` stops the input's `onBlur` from firing before the click registers.

**Disabled state (ResidentCombobox):** When `disabled={true}` (e.g. no facility selected yet), render a non-interactive placeholder div instead of the input:
```tsx
<div className="rounded-lg border border-stone-100 bg-stone-50 px-2 py-1 text-xs text-stone-400">
  Select facility first
</div>
```

**AbortController cleanup:** Any `useEffect` that triggers a fetch keyed on a selection change must use `AbortController` + return a cleanup that calls `controller.abort()`. Swallow `AbortError` silently in the `.catch()`.

**Styles (FacilityCombobox — larger, full-width):**
- Input: `rounded-xl border border-stone-200 px-3 py-2 pr-8 text-sm focus:border-[#8B2E4A] focus:ring-2 focus:ring-rose-100 focus:outline-none`
- Dropdown: `absolute z-50 mt-1 w-full bg-white border border-stone-200 rounded-xl shadow-lg max-h-64 overflow-y-auto`
- Each option: `px-3 py-2 text-sm hover:bg-stone-50 cursor-pointer`

**Styles (ResidentCombobox — compact, inside a table row):**
- Input: `rounded-lg border border-stone-200 px-2 py-1 pr-6 text-xs focus:border-[#8B2E4A] focus:ring-2 focus:ring-rose-100 focus:outline-none`
- Dropdown: `absolute z-50 mt-1 w-full bg-white border border-stone-200 rounded-xl shadow-lg max-h-48 overflow-y-auto`
- Each option: `px-2 py-1.5 text-xs hover:bg-stone-50 cursor-pointer`

**Shared across both:**
- Selected option: `bg-rose-50 text-[#8B2E4A] font-medium`
- Room number prefix: `<span className="text-stone-400 mr-1">{roomNumber} ·</span>` before the name
- X clear button: positioned `absolute right-2 top-1/2 -translate-y-1/2`, `tabIndex={-1}`, `onMouseDown` with `e.preventDefault()` to avoid blur race
- "No results" state: same dropdown container with `text-stone-400` message inside

### Document Type Badge

Small pill label identifying the OCR-detected document type in the scan confirmation screen. Shown next to the confidence badge in a `flex items-center gap-1.5` wrapper.

**Lookup map at module level:**

```ts
const DOC_TYPE_LABEL: Record<string, string> = {
  RFMS_PETTY_CASH_BREAKDOWN: 'Petty Cash',
  RFMS_REMITTANCE_SLIP: 'Remittance',
  RFMS_FACILITY_CHECK: 'Facility Check',
  FACILITY_CHECK: 'Facility Check',
  IP_PERSONAL_CHECK: 'Personal Check',
  REMITTANCE_SLIP: 'Remittance',
}
```

**Style:** `bg-stone-100 text-stone-600 text-xs font-semibold px-2 py-0.5 rounded-full`

**Visibility:** Hidden when `documentType === 'UNREADABLE'`

### Full-page async operation overlay (e.g. PDF import parse)

When a slow async operation (Gemini API call, large upload) runs from a page — not a modal — use a `fixed inset-0` overlay so the user can't interact with the underlying page while waiting. Pattern (`import-client.tsx`):

```tsx
{parsing && (
  <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center">
    <div className="bg-white rounded-2xl shadow-xl p-8 flex flex-col items-center gap-4 mx-4 w-full max-w-xs">
      <div className="w-12 h-12 rounded-full bg-rose-50 flex items-center justify-center">
        <svg ...icon... stroke="#8B2E4A" />
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-stone-800">Importing services...</p>
        <p className="text-xs text-stone-400 mt-1">Analyzing your price sheet</p>
      </div>
      <div className="w-full h-1.5 rounded-full bg-stone-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-[#8B2E4A]"
          style={{
            width: `${progress}%`,
            transition: progress === 70 ? 'width 2s cubic-bezier(0.4, 0, 0.2, 1)' : 'width 0.4s ease-out',
          }}
        />
      </div>
    </div>
  </div>
)}
```

**Two-phase progress animation**: on start, `setProgress(0)` then `setTimeout(() => setProgress(70), 50)` — the 50ms delay forces the browser to paint the bar at 0% before the 2s phase-1 animation begins (without delay, React batches both updates and the animation never plays). On response: `setProgress(100)`, then `await new Promise(r => setTimeout(r, 400))` so the user sees 100% briefly before the overlay disappears. `transition` switches from `'width 2s cubic-bezier(0.4, 0, 0.2, 1)'` (phase 1, slow/eased) to `'width 0.4s ease-out'` (phase 2, quick snap) based on whether `progress === 70`.

State: `parsing: boolean` + `progress: number (0–100)`. Set `parsing=false` in `finally` so errors also dismiss the overlay.

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

### Typed-Name Confirmation Modal (irreversible operations)

For operations that cannot be undone automatically (e.g. facility merge), use a modal that requires the operator to type the target's exact name before the destructive action enables.

- Modal shell: `fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4` with a `bg-white rounded-2xl shadow-xl p-6 max-w-md w-full` panel.
- Explain the effect in one paragraph — name both sides of the operation in `<strong>`, end with "This cannot be undone automatically."
- Label: "Type the secondary facility name to confirm:" → `<input autoFocus>` bound to local `typedName` state. Use `placeholder={exactName}` so the operator can see what to type.
- Primary button: `disabled={!typedOk || busy}`. `typedOk = typedName.trim().toLowerCase() === exactName.toLowerCase()`. Label flips to "Merging…" (or equivalent `-ing` form) while the request is inflight.
- Secondary: "Cancel" clears both `confirmPair` and `typedName` state.
- Pattern lives in `src/app/(protected)/super-admin/merge-tab.tsx` (Phase 11E).

### Pair Card (primary/secondary comparison)

When an admin compares two records side-by-side before merging/linking them:

- Row layout: `grid grid-cols-[1fr_auto_1fr] gap-2 items-stretch`. The middle auto column holds a swap button (`⇄` — rounded `p-2 hover:bg-stone-100`, `title="Swap primary / secondary"`).
- Primary card: `bg-stone-50 border-stone-200`, tiny `"Keep (primary)"` caption (`text-[10px] font-semibold uppercase tracking-wide text-stone-500`).
- Secondary card: `bg-amber-50 border-amber-200`, caption `"Merge away (secondary)"`. The amber tint visually signals the side that will be destroyed.
- Both cards show: facility-code chip (stone mono) or "No FID" amber pill if code is null, truncated name, `residents · bookings · stylists` counts, and optional address/email in `text-stone-400`.
- Pair header row above the grid shows the fuzzy score percentage left + confidence badge right.
- Pattern lives in `src/app/(protected)/super-admin/merge-tab.tsx` (Phase 11E).

### Confidence Badge

Used anywhere we surface a fuzzy-match score to the operator.

- Shape: `text-xs px-2 py-0.5 rounded-full font-medium border`.
- High (score = 1.0 or similar exact): `bg-emerald-50 text-emerald-700 border-emerald-200`, label "High confidence".
- Medium (≥ 0.8): `bg-amber-50 text-amber-700 border-amber-200`, label "Likely match".
- Low (≥ 0.6): `bg-stone-100 text-stone-600 border-stone-200`, label "Review carefully".
- Pattern lives in `src/app/(protected)/super-admin/merge-tab.tsx` (Phase 11E).

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

### Booking modal — read-only auto-assigned stylist (2026-04-25)

The admin booking modal does **not** show a stylist `<select>`. Stylist assignment is date-driven and read-only.

**Position:** between the Services field and the Date & Time field.

**Fetch:** a `useEffect` keyed on `[open, mode, startTime, selectedServiceIds.join(','), facilityId]` calls `GET /api/stylists/available?facilityId=…&startTime=…&endTime=…` whenever both a date AND ≥1 service are picked. Uses `AbortController` so later picks supersede in-flight requests. Skipped entirely in `mode === 'edit'`.

**Four display states:**
- **Edit mode** — plain text showing `booking.stylist?.name` (with the stylist's color swatch). PUT body never sends `stylistId`; existing assignment is preserved.
- **Create mode, no date or no services yet** — muted hint: `"Pick a date and service(s) to see who's scheduled."`
- **Loading** — `"Checking availability…"` text.
- **No candidates available** — amber block (`bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3 py-2 text-sm`): `"No stylist available for {weekday} at {time}. Please choose a different date or time."` Submit is disabled.
- **Picked** — read-only display: 16px color swatch (from stylist `color`) + name + sub-label `"Auto-assigned (least-loaded)"`.

**Submit gating:** `submitDisabled = submitting || (mode === 'create' && (!pickedStylist || loadingStylists))`. Used by both the desktop modal footer button and the mobile bottom-sheet footer button.

**Why exact-name preview (not a lightweight day-of-week check):** the modal calls the full `resolveAvailableStylists` + `pickStylistWithLeastLoad` pipeline so the previewed name matches what `POST /api/bookings` will actually pick at submit time. The extra round-trip is acceptable because it only fires when both date AND services are set.

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

### Compliance badge (Phase 7 SHIPPED 2026-04-14)
Four-state compliance status computed by `computeComplianceStatus(stylist, docs)` in `src/lib/compliance.ts`:
- **Green** (`bg-emerald-500`) — required docs (license + insurance) verified, all expiries >30 days, no unverified docs
- **Amber** (`bg-amber-400`) — any required doc expires within 60 days OR any unverified doc present
- **Red** (`bg-red-500`) — any doc expired OR a required type missing / unverified
- **None** — no signals at all; render nothing (no dot)

Dot placement: `w-2 h-2 rounded-full shrink-0` next to the stylist calendar-color swatch on the Stylists list, with a `title={complianceStatusLabel(status)}` tooltip. Never use Tailwind `text-*` for status dots — always `bg-*` to ensure color-blind distinction.

### Compliance document type badges (Phase 7)
Small uppercase pills inside the My Account + Stylist Detail document lists, rendered via inline `<span>` (not the `Badge` component, so they stay inside a grid row):

| Type | Classes | Label |
|------|---------|-------|
| `license` | `bg-blue-50 text-blue-700` | License |
| `insurance` | `bg-purple-50 text-purple-700` | Insurance |
| `w9` | `bg-stone-100 text-stone-700` | W-9 |
| `contractor_agreement` | `bg-stone-100 text-stone-700` | Contractor Agreement |
| `background_check` | `bg-emerald-50 text-emerald-700` | Background Check |

Verified state chip next to the badge: `bg-emerald-50 text-emerald-700` "Verified" vs `bg-amber-50 text-amber-700` "Pending review". Each row has the original filename rendered as a `<a>` to the 1-hour signed URL (opens in a new tab), the doc-type badge, expiry text (or `—`), verified chip, and a delete icon (two-step inline confirm). Upload form is inline (not modal) with type `<select>`, file input, and an expiry `<input type="date">` shown only when the type is `license` or `insurance`.

### Coverage request status chips (Phase 8)
Reuse the existing `Badge` component: `open` → amber, `filled` → emerald, `cancelled` → stone.

### Stylist status + specialties + assignments + notes (Phase 9 — schema shipped, UI in Prompt 2+)
- **Status badge** (next to stylist name on list + detail): `active` → emerald, `on_leave` → amber, `inactive` → stone, `terminated` → red. Admin-only dropdown edits `status` via `PUT /api/stylists/[id]`. Status dot pattern: `<span className={cn('w-2 h-2 rounded-full shrink-0', statusDot(status))} />` inline with the select. `statusDot()` maps `active → bg-emerald-500`, `on_leave → bg-amber-400`, else `bg-stone-400`.
- **Specialties chips**: small rose-50 pills (`bg-rose-50 text-rose-700`), editable on Stylist Detail — `+ Add` opens an inline text input, ✕ removes. Persisted as `string[]` via `PUT /api/stylists/[id]`.
- **Assignments tab** on Stylist Detail: list of per-facility rows (facility name, commission override input, active toggle). Empty commission field = "inherit stylist default" rendered as ghost placeholder showing the default percent. `resolveCommission(stylistDefault, assignment)` is the source of truth everywhere a commission is displayed or used to compute payout — never inline math.
- **Notes section** (admin-only): stacked list of author-name + timestamp + body; `+ Add note` textarea at the top. Never surfaced to stylist-role or portal views.

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

---

## 9. Resident Portal Design Patterns

The portal (`src/app/(resident)/`) uses the **brand burgundy palette** — distinct from the admin teal.

### Portal color palette
- Background: `#FDF8F8` (warm blush, set via inline style on layout wrapper)
- Header background: `#8B2E4A` (burgundy, inline style)
- Header hover/active: `#72253C` / `#5c1e2e`
- Primary buttons: `style={{ backgroundColor: '#8B2E4A' }}`
- Selected card border: `border-[#8B2E4A]`
- Selected card bg: `bg-rose-50`
- Focus rings: `focus:border-[#8B2E4A] focus:ring-2 focus:ring-rose-100`
- Checkboxes: `accent-[#8B2E4A]`
- POA banner: `bg-rose-50 border border-rose-200 text-rose-800`
- Stepper + button: `bg-[#8B2E4A] hover:bg-[#72253C]`

### Floral SVG header accent
Inline SVG rose outline in the portal header, positioned `absolute right:-8px top:-10px`, `width:80px height:96px`, `pointerEvents:none`. Stroke colors use `rgba(255,255,255,0.15)` for outer petals and `rgba(255,255,255,0.12)` for inner details/stem/leaves. viewBox `0 0 100 120`. The SVG is in `src/app/(resident)/layout.tsx` and uses no external assets.

### Portal vs. admin color boundary
- Portal files (`src/app/(resident)/`) → burgundy `#8B2E4A` / rose-* palette
- Admin files (`src/app/(protected)/`) → keep existing teal `#0D7377` (except entry pages: onboarding, unauthorized)
- Entry/auth pages (onboarding, invite/accept, unauthorized) → burgundy CTAs, rose selected states
- `src/components/ui/button.tsx` → still teal `#0D7377` (admin-wide component, not changed)

### Service picker — collapsed summary row pattern
After a service is selected in single-row mode, the full card grid collapses to a compact row:
```
bg-rose-50 border border-rose-200 rounded-xl px-4 py-3
  color dot (w-2.5 h-2.5) + service name (font-semibold truncate) + price (text-xs text-stone-500)
  "Change" link → text-xs font-medium text-[#8B2E4A] (right side)
```
State: `pickerOpen: Record<number, boolean>` — `false` = collapsed, `true`/undefined = open.
Collapse triggers in `setServiceAt()` via 150ms `setTimeout` when `totalRows <= 1`.
Reset to `{}` on `startBooking()`.

### Status badge colors in portal
The `STATUS_STYLES` record in portal-client.tsx uses semantic colors (not brand colors):
- `completed`: `bg-teal-50 text-teal-700` — keep as-is (teal is semantic for "done" status here, not brand)

### Coverage request status badges (Phase 8)
Used on the My Account Time Off list. Small pill: `px-2 py-0.5 rounded-full text-xs font-semibold`.
- `open`: `bg-amber-50 text-amber-700`
- `filled`: `bg-emerald-50 text-emerald-700`
- `cancelled`: `bg-stone-100 text-stone-500`

### Coverage banner (Phase 8)
The admin dashboard coverage banner reuses the **exact class signature** of the pending access-requests banner — only the copy and the action differ:
`shrink-0 px-4 py-2.5 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-between`. The action is a `<button>` (not `<a>`) that calls `document.getElementById('coverage-queue')?.scrollIntoView({ behavior: 'smooth', block: 'start' })`. Never diverge the visual language between the two amber banners — they stack and should read as one system.

### Weekly availability row (Phase 8)
Each of the 7 day rows in the My Account Weekly Availability card:
```
min-h-[44px] flex items-center gap-3
  <input type="checkbox" accent-[#8B2E4A]> + <day label 3-char>
  <input type="time" startTime> "to" <input type="time" endTime>
```
When `active === false`, both time inputs get `opacity-50` and are visually disabled (still editable — toggling active=true keeps the same times). Mobile tap-target is guaranteed by `min-h-[44px]`. Validation message ("End must be after start") renders as a red `text-xs` line below the grid on save. Inline feedback uses local `savedMsg`/`availError` state — no toast system in my-account-client.tsx.

### Coverage Queue card (Phase 8)
Admin dashboard right-rail card placed **above** the residents/services/stylists tabs, with `id="coverage-queue"`. Hidden entirely when the queue is empty to preserve vertical space for the panel + stats footer below. Wrapper: `shrink-0 bg-white rounded-2xl border border-stone-100 shadow-sm`. Row anatomy: stylist name (font-semibold, truncate) + formatted date label (`Short, MMM D`) + reason (2-line clamp, muted) + substitute `<select>` + burgundy Assign button (`bg-[#8B2E4A] hover:bg-[#72253C]`, disabled until substitute picked). List scrolls within `max-h-[320px] overflow-y-auto divide-y divide-stone-100`. Assignment optimistically removes the row from local state without `router.refresh()`.


### Directory list row (Phase 8.5)
Stylist Directory page (`/stylists/directory`) list-row anatomy — burgundy-palette compact rows for franchise admin scanning. Each row is a `<Link>` with `flex items-center gap-3 px-5 py-3.5 hover:bg-stone-50`:
1. **ST code** (`font-mono text-xs text-stone-500 w-16 shrink-0`) — left-aligned, fixed width for alignment across rows
2. **Color dot** (`w-3 h-3 rounded-full`, `style={{ backgroundColor: s.color }}`)
3. **Name** (`text-sm font-semibold text-stone-900 flex-1 truncate`)
4. **Facility badge** (`text-xs px-2 py-0.5 rounded-md`) — `bg-stone-100 text-stone-600` when assigned, **`bg-rose-50 text-[#8B2E4A]`** reading "Franchise Pool" when unassigned
5. Commission % (hidden below sm breakpoint), chevron

Filter pills above the list live inside a single `rounded-xl border border-stone-200` shell; the active pill uses `bg-[#8B2E4A] text-white`, inactive uses `text-stone-600 hover:bg-stone-50`. Search input is full-width `rounded-xl` with `focus:ring-2 focus:ring-rose-100`.

**Status filter + row badge (Phase 9 Prompt 3):** a second pill group sits beside the assigned/unassigned pills with values "All / Active / On Leave / Inactive" — same shell styling. Each row renders an inline status pill next to the name when `stylist.status !== 'active'`:
- `on_leave` → `bg-amber-50 text-amber-700`, label "On leave"
- `inactive` → `bg-stone-100 text-stone-600`, label "Inactive"
- `terminated` → `bg-stone-200 text-stone-600`, label "Terminated"
Pill class: `text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0`. The `/stylists` booking-surface page filters to `status='active'` and never shows badges.

**Add Stylist inline form (Phase 9 Prompt 3 fix):** wrapped in `<form onSubmit={e => { e.preventDefault(); handleAdd() }}>` so Enter submits from any input. Submit button is `type="submit"`, Cancel is `type="button"`. The ST code input has no `pattern=` attribute — HTML-native `pattern` silently blocks submit without user feedback when mismatched, and Zod already validates server-side. Name input gets `autoFocus`.

### Who's Working Today card (Phase 9 Prompt 4)
Admin-only right-rail card on `/dashboard`, rendered above the Coverage Queue card. Hidden when both today and tomorrow lists are empty. Structure:

```
WHO'S WORKING TODAY                  ← px-4 py-3 border-b, text-xs font-semibold text-stone-500 uppercase tracking-wide
──────────────────────────────
● Sierra M.   9:00am–5:00pm          ← color dot (w-2.5 h-2.5 rounded-full, inline style backgroundColor) + name (font-medium flex-1 truncate) + time (text-xs text-stone-400 shrink-0)
──────────────────────────────
Tomorrow: Sierra M., Senait E.        ← text-xs text-stone-400, border-t border-stone-50, "Tomorrow:" in font-medium
```

Empty state: `"No stylists scheduled today"` in `text-sm text-stone-400 italic`. Time format uses `formatHHMM(t)` (file-local helper in `dashboard-client.tsx`): `"09:00"` → `"9:00am"`. Do NOT use `formatTime()` from utils.ts for HH:MM strings.

### My Account "Your Schedule" (Phase 9 Prompt 4)
Replaces the flat 7-day availability checkbox grid. Display order: Mon→Tue→Wed→Thu→Fri→Sat→Sun (dayOfWeek `[1,2,3,4,5,6,0]`). Each day row:

- **Has active availability row**: `facilityName` (text-xs text-stone-500 flex-1 truncate) + formatted hours (text-sm text-stone-700) + `[Edit hours]` button (text-xs text-[#8B2E4A] hover:text-[#72253C] ml-auto)
- **No active availability row**: `— not scheduled` (text-sm text-stone-400 italic)
- **Editing state**: two `<input type="time">` side-by-side + Save button (burgundy, disabled during save) + Cancel text button

Save sends the full 7-day array to existing `PUT /api/availability` (full-week atomic replace — no API change). `DayRow` state type includes `facilityId?: string` so the facility name can be looked up from the `stylistAssignments` prop. `formatHHMM()` used for display.

### Stylist Detail — email display + invite button (Phase 9 Prompt 4)
Below the Commission % field in the info card, when `stylist.email` is set and caller `isAdmin`:

```
EMAIL                                    ← text-xs font-semibold text-stone-500 uppercase tracking-wide
senait@example.com                       ← text-sm text-stone-700 break-all

[Send account invite →]                 ← text-xs font-medium text-[#8B2E4A] underline, when no linked account + no recent invite
[Sending…]                              ← disabled state
[Invite sent ✓]                         ← after success (inviteStatus='sent')
Invite sent 3h ago                      ← text-xs text-stone-400, when lastInviteSentAt < 24h
✓ Account linked                        ← text-xs text-emerald-600 font-medium with checkmark SVG, when hasLinkedAccount
```

State: `inviteStatus: 'idle'|'sending'|'sent'|'error'` in StylistDetailClient. Errors surface via existing `setError()`. The `hasLinkedAccount` boolean and `lastInviteSentAt` string are fetched in `page.tsx` and passed as props.

### Grouped substitute picker (Phase 8.5)
Coverage Queue rows now lazy-fetch `/api/coverage/substitutes?date={request.startDate}` on mount and render a `<select>` with two `<optgroup>` blocks — "This Facility" + "Franchise Pool". Each `<option>` shows `{name} ({stylistCode})` so admins can eyeball the ST code. When one group is empty the `<optgroup>` is omitted rather than rendered with no children. The Assign button stays disabled until a substitute is picked.

### Date-range time-off form (Phase 8.5)
My Account Time Off inline form now has two `<input type="date">` inputs in a `grid grid-cols-2 gap-3`: Start date and End date. Both use `min={todayStr}`; the End input's `min` is `coverageStartDate || todayStr`. When the user picks a start date that's after the current end, the end auto-bumps to match. Submit button disabled until both dates are filled; an inline client-side check ensures `end >= start` (server enforces via Zod `.refine` too). List rows below format as `{start === end ? formatCoverageDate(start) : `${formatCoverageDate(start)} – ${formatCoverageDate(end)}`}`.

### License state badge on Stylists list (bookkeeping CSV import, 2026-04-15)
After the stylist name on the Stylists list (`/stylists`), a subtle badge renders when `licenseState` is set. It splits the comma-separated value and joins with `" • "` (e.g. `"MD, VA"` → `"MD • VA"`). Classes: `text-[10px] font-semibold text-stone-500 px-1.5 py-0.5 rounded bg-stone-100 shrink-0`. The name and badge are wrapped in a `flex items-center gap-2 flex-wrap` div. The badge only renders when `stylist.licenseState` is truthy.

### Stylist Detail — License + Contact + Schedule notes (bookkeeping CSV import, 2026-04-15)
- **License section**: four fields — Number, Type, **Licensed In** (= `licenseState`, editable input, placeholder "e.g. MD, VA"), Expires. Licensed In is the third field.
- **Phone numbers section** (above Contact, admin-only, fully editable): shown always for admins. Header row: "Phone numbers" label (`text-xs font-semibold text-stone-500 uppercase tracking-wide`) + inline `+ Add` button top-right (`text-xs text-[#8B2E4A] font-semibold`). Placeholder "No phone numbers" (`text-xs text-stone-400 italic`) when empty. Each phone row: label `<select>` (24w, options: mobile/office/home/work/fax/custom) + optional custom label text input when `select=custom` (20w) + number text input (flex-1) + ✕ remove button. All inputs use `bg-stone-50 border border-stone-200 rounded-lg px-2 py-1.5 text-xs`. Stored label: if not in the standard set (all options except 'custom'), show 'custom' in select and the actual label in the text input. Saves via `phones` array in PUT `/api/stylists/[id]`. Zod: `.array(z.object({label:z.string().max(50), number:z.string().max(50)})).max(10)`.
- **Contact section** (below phone numbers, admin-only, **always visible for admins**): Address as an `<input type="text">` with placeholder "123 Main St, City, State". Payment method as a `<select>` dropdown with options: Commission / Hourly / Flat Rate / Booth Rental (empty default "— select —"). Both use the standard field class: `w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-rose-100 transition-all`. Both wired into `isDirty` and the single `handleSave → PUT /api/stylists/[id]` call.
- **Schedule notes** (below Availability card): shown when `stylist.scheduleNotes` is set. Label: "Schedule notes (unmatched facilities)" (`text-[11px] font-semibold text-stone-400 uppercase tracking-wide`). Note text: `text-xs text-stone-500 italic`. Renders inside the Availability card's bottom padding area (not a separate card).

### Franchise owner (super_admin) nav (bug fix 2026-04-15, updated Phase 11J.1)
Franchise owners have `facility_users.role = 'super_admin'` in the DB. `getUserFacility()` normalizes `'super_admin'` → `'admin'` at read time via `normalizeRole()`; `layout.tsx` does the same normalization for `activeRole`. As of Phase 11J.1, `NavRole` in sidebar.tsx, mobile-nav.tsx, and top-bar.tsx is the full union `'admin' | 'super_admin' | 'facility_staff' | 'bookkeeper' | 'stylist' | 'viewer'`, but the normalization still runs first so any per-item `roles: ['admin', ...]` array still applies to franchise owners. Continue normalizing at the source — do not duplicate `super_admin` in nav role arrays.

### Sidebar nav structure (Phase 11J.1, 2026-04-26)
Four nav groups under `<nav>`:
- **SCHEDULING** — Calendar / Residents / Daily Log
- **MANAGEMENT** — Stylists / Directory / Services
- **FINANCIAL** — Billing / Analytics / Payroll  *(renamed from "ANALYTICS")*
- **ACCOUNT** — My Account *(stylist-only group; group label hides for other roles since visibleItems is empty)*

Below `</nav>`, a divider (`border-t border-white/10 mx-1 mb-2`) separates the always-last block:
- **Settings** — visible to admin / facility_staff / bookkeeper
- **Master Admin** — visible only to master admin email AND `!debugMode` (label renamed from "Super Admin"; route still `/super-admin`)

Both Settings and Master Admin use the standard nav-link styling pattern (`bg-[#8B2E4A]/30 text-white font-semibold shadow-inner` when active, `text-white/70 hover:bg-white/5` otherwise). Settings shares the `SettingsIcon` constant defined at module level so the icon JSX isn't duplicated.

### Invite role badge palette (Phase 11J.1)
`src/app/(protected)/settings/settings-client.tsx` exposes two helpers at module level: `roleBadgeClass(role)` returns the tailwind classes for the invite role pill, and `roleBadgeLabel(role)` returns the display string. Palette:
- `admin`, `super_admin` → `bg-[#fdf2f4] text-[#8B2E4A]` (burgundy tint)
- `facility_staff` → `bg-blue-50 text-blue-700`
- `bookkeeper` → `bg-emerald-50 text-emerald-700`
- `viewer` → `bg-amber-50 text-amber-700` (legacy)
- everything else (incl. `stylist`) → `bg-stone-100 text-stone-500`

Use these helpers anywhere a role badge needs to render. The invite picker `<select>` shows: Admin / Facility Staff / Bookkeeper / Stylist (and "Super Admin (franchise)" only for `isSuperAdmin`). `viewer` is removed from the picker — legacy invites still render with the amber palette.

### Applicant Pipeline — Directory tab switcher (Phase 9.5, 2026-04-16)
Directory page gains a segmented control at the top: `flex rounded-xl border border-stone-200 overflow-hidden bg-white w-fit mb-6`. Two buttons: "Stylists" and "Applicants". Active tab: `text-white` with `style={{ backgroundColor: '#8B2E4A' }}`. Inactive tab: `text-stone-600 hover:bg-stone-50`. The Applicants button shows a `•N` count pill when there are applicants (invisible when 0). Entire existing Stylists content wrapped in `{activeTab === 'stylists' && (<>...</>)}`. Floating bulk-action bar stays outside both tab conditions (driven by `selected.size > 0` which only applies in Stylists mode).

### Applicant Pipeline — Applicants tab (Phase 9.5, 2026-04-16)
**Toolbar row** (`flex flex-wrap gap-3 items-center mb-4`): search input (rounded-xl, stone border, placeholder "Search by name, email, location, or ZIP"), optional radius `<select>` (appears only when search is exactly 5 digits; options 5/10/15/25/50 miles; `appRadiusMiles` state default 15), status filter pills (All/New/Reviewing/Contacting/Hired/Rejected with live counts — same pill pattern as Directory scope filter), "Import CSV" button (burgundy `#8B2E4A`), hidden `<input type="file" accept=".csv">` via ref.

**ZIP radius search**: When `appSearch.trim()` matches `/^\d{5}$/`, `filteredApplicants` useMemo calls `getZipsWithinMiles(q, appRadiusMiles)` once to produce `nearbyZips: string[]`, then passes it into `appMatchesSearch(a, q, nearbyZips)`. Inside that function, `extractZip(a.location ?? '')` pulls the first `\b\d{5}\b` from the applicant's location string and checks membership in `nearbyZips`. If no ZIP is in scope the function falls through to the normal fuzzy/metro match. Static table lives in `src/lib/zip-coords.ts`.

**Import result banner**: `bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-xl px-4 py-3` — "Imported N new applicants, M already existed." with ✕ dismiss button.

**Empty state**: `bg-white rounded-2xl border border-stone-100 shadow-sm p-12 text-center` — "No applicants yet. Import a CSV from Indeed to get started." (text-stone-400 text-sm).

**Applicant row** — **grid layout** `grid-cols-[1fr_140px_120px_100px_100px_32px]` matching a sortable header row above it. Columns: name+location stack (flex-1), applied date, location, job title, inline status `<select>` (text-xs rounded-lg), expand chevron `<span>`. Entire row is `cursor-pointer` and expands/collapses on click. The `<select>` uses `e.stopPropagation()` on `onClick` and `onChange`. Chevron is a `<span aria-hidden>` (not a button). The row does NOT show a separate status badge pill — only the `<select>` controls status.

**Sort header** above the applicant list: same `grid-cols-[1fr_140px_120px_100px_100px_32px]`. Five sortable columns (Name, Date Applied, Location, Job, Status) each with ↑↓ arrow when active. Default sort: Date Applied descending.

**Status filter pills** use inline Tailwind classes per status (not a named constant):
- `new` → `bg-stone-100 text-stone-600`
- `reviewing` → `bg-blue-50 text-blue-700`
- `contacting` → `bg-amber-50 text-amber-700`
- `hired` → `bg-emerald-50 text-emerald-700`
- `rejected` → `bg-red-50 text-red-600`

**Expanded detail panel** (`px-4 pb-4 pt-2 bg-stone-50 border-b border-stone-100`): two-column grid for contact fields (email with "via Indeed" amber pill when `isIndeedEmail`, phone). Experience/education/qualifications as labeled sections. Notes as full-width `<textarea>` (border-stone-200 rounded-xl, auto-saves on `onBlur` if changed). "Promote to Stylist →" button (burgundy, hidden when `status === 'rejected'`). On promote success: "Promoted! View stylist profile →" link (emerald text, `Link` from next/link).

**`formatAppliedDate(d: string): string`** — parses `'YYYY-MM-DD'` as `new Date(d + 'T00:00:00')` (avoids UTC timezone shift) → `toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })` → `"Apr 12, 2025"`.

**Inline status dropdown** updates local state optimistically (no spinner) and fires `PUT /api/applicants/[id]` in the background — same fire-and-forget pattern as other lightweight inline mutations.

**Notes auto-save on blur** only fires a `PUT` when `expandedNotes !== (applicant.notes ?? '')` — avoids spurious network requests when the field was never changed.

**Qualifications Q&A display** — each item shows `Question: [Badge]` with NO plain-text answer echo. The answer is shown only as a badge (e.g. `[Yes]`), not as duplicate text before the badge.

### Smart default service selection (booking modal + walk-in form, 2026-04-16)

**Booking modal**: `selectedServiceIds` is initialized to `[]` in create mode — do NOT use `primaryServiceCandidates[0]` or `services[0]`. When a resident is selected, a `useEffect` pre-selects `mostUsedServiceId` if the resident has booking history. New residents (null `mostUsedServiceId`) get no auto-selection.

**Walk-in form** (`log-client.tsx`): both the initial `wiServiceId` state (`useState('')`) AND the post-submission reset (`setWiServiceId('')`) use empty string. Never reset to `services[0]?.id`.

`mostUsedServiceId` is NOT stored in the DB — it is computed by `getMostUsedServiceIds(facilityId)` in `src/lib/resident-service-usage.ts` at page-load time in `dashboard/page.tsx` and `log/page.tsx`, then merged onto each resident via `map()` before passing to the client.

### Portal multi-service booking (fully implemented)

The portal (`src/app/(resident)/portal/[token]/portal-client.tsx`) supports multi-service selection:
- `selectedServiceIds: string[]` array — pre-selects `mostUsedServiceId` prop on `startBooking()` if the service still exists and is non-addon; otherwise starts empty
- `mostUsedServiceId` prop is computed in `portal/[token]/page.tsx` by querying the resident's non-cancelled bookings grouped by serviceId; passed as `mostUsedServiceId?: string | null`
- First selection: card grid showing all non-addon services grouped by category; tapping a card calls `setServiceAt(0, id)` and auto-collapses to a compact summary row after 150ms (single row only)
- **Section order after first selection**: (1) selected service summary row(s), (2) tiered stepper / multi-option picker, (3) "+ Add another service" dashed button, (4) addon checklist, (5) price breakdown, (6) Continue button
- "+ Add another service" dashed button: `min-h-[56px]` touch target (senior-friendly), capped at `Math.min(4, nonAddonServices.length)` total slots; appends `''` to the array, showing the full card grid for that slot with an "Additional Service" label + "Remove" button; positioned **before** the addon checklist so users add all primary services first
- Addon checklist: appears below the "+ Add another service" button; checkboxes with `accent-[#8B2E4A]`; 44px min-height tap targets
- Live price breakdown: primary + additional services + addon lines; `text-amber-700` for addons; Total + Duration footer
- `handleBook` sends `{ serviceIds, addonServiceIds, selectedQuantity?, selectedOption? }` — never `serviceId` (singular)
- `POST /api/portal/[token]/book` fully handles `serviceIds[]` + `addonServiceIds[]` — no API changes were needed

### Services page sort default

Default `sortKey` is `'category'`, default `sortDir` is `'desc'` (Z→A, so Nail Services before Hair before Color). The server-side `orderBy` uses the callback form `(t, { asc, desc }) => [desc(t.category), asc(t.name)]`. Section headers between categories only render when `sortKey === 'category'`.

### Stylist directory — last name sort

Stylists are sorted by last name (last word in `name`) entirely on the client:
- **No server `orderBy`** — `directory/page.tsx` does NOT pass `orderBy` to `findMany`. The SQL `split_part` expression was removed.
- **Client** (`sorted` useMemo, `sortKey === 'name'` branch): `name.split(' ').pop() ?? ''` for the `localeCompare` comparator
- Sort header label is **"Last Name"** (not "Name").

### Stylist directory — bulk action bar

Floating bar appears when `selected.size > 0`. Structure: `fixed left-1/2 -translate-x-1/2 z-40 flex flex-wrap items-center gap-2 px-4 py-3 rounded-2xl bg-white border border-stone-200 shadow-lg max-w-[calc(100vw-32px)]`. Bottom: `calc(env(safe-area-inset-bottom) + 80px)`.

Three sibling edit controls — only one may be non-empty at a time (changing one auto-clears the other two via `onChange`):
1. `<select>` — Set Status (Active / Inactive / On Leave / Terminated)
2. `<select>` — Set Facility (franchiseFacilities prop options)
3. `<input type="number" min=0 max=100>` — Set Commission %

**Apply** button (burgundy `#8B2E4A`) — disabled when all three controls are empty or `applyingBulk`. Calls `handleBulkUpdate` → `POST /api/stylists/bulk-update` → optimistic local state update → toast. No `router.refresh()`.

**Delete** button (red-500) and **Clear** button unchanged.

### Integration connection card (Stripe + QuickBooks)

Shared card pattern for third-party service connections in Settings → Integrations tab. Both Stripe and QuickBooks Online use the exact same structural rhythm:

- Container: `rounded-2xl border border-stone-200 bg-white p-5`
- Header row: flex, title `font-serif text-lg text-stone-900` + optional `✓ Connected` pill when active (`bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-xs font-semibold px-2 py-0.5`)
- Body: one-line description in `text-sm text-stone-600` when disconnected; compact details (realm ID in `font-mono text-xs`, form selects, action row) when connected
- Primary action button: burgundy `bg-[#8B2E4A] hover:bg-[#72253C] text-white rounded-xl px-4 py-2`
- Secondary actions: stone outline `border border-stone-200 rounded-xl px-3 py-2 text-stone-700 hover:bg-stone-50`

**Connect flow**: primary action is a plain `<a href="/api/<integration>/connect">` (full-page redirect — OAuth providers require it, cannot run in a modal). After the provider redirects back, handle `?<integration>=connected` / `?<integration>=error&reason=…` URL params on mount: show an emerald/red toast, then `window.history.replaceState` to strip the query so the toast doesn't re-fire on re-render.

### Two-click disconnect confirm

Used anywhere an action is destructive + reversible-by-restart (Remove Access on the Team tab, Disconnect on Integration cards). Pattern:

- State: `const [confirm, setConfirm] = useState(false)`
- First click shows the red "Disconnect" label
- Second click (within ~3s or until the mouse leaves) fires the mutation
- `onMouseLeave={() => setConfirm(false)}` cancels the armed state so the user can back out without refreshing
- While `confirming`: swap copy to `"Disconnect? Yes"` (red) + keep a `"No"` ghost next to it; `text-red-600` and bold weight differentiate from the idle state

Never use a modal `window.confirm()` — the two-click pattern keeps the action inline and mobile-friendly.

### "Push to QuickBooks" button — three states

Used on `/payroll/[id]` when `hasQuickBooks && period.status !== 'open'`:

- **Idle** (never pushed, or re-push after a status change): primary burgundy pill, label `Push to QuickBooks` or `Re-push`.
- **Pending** (mutation in flight): same pill, disabled, label swaps to `Pushing…`, no spinner icon (keep it flat — the disabled state is enough signal on a button this prominent).
- **Error with retry**: below the idle button, a red banner `rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700` listing the per-stylist failures as `<stylistName>: <message>` lines, with a `[Retry Sync]` text-button (red, underlined-on-hover) that re-runs the same `sync-bill` mutation. Success clears the banner on the next push.

Synced state (all stylists OK) shows a muted `Synced to QuickBooks <relative-date>` caption + `[Sync Payment Status]` secondary button. Optimistic local state toggles the status badge on a successful status-sync response; `router.refresh()` on success re-hydrates the underlying period row.

### Public legal pages (`(public)` route group)

Used for `/privacy` and `/terms` — static server components with no auth.

- **Container**: `max-w-3xl mx-auto px-6 py-12` inside `min-h-screen` with `backgroundColor: '#F7F6F2'`
- **Header**: same burgundy `#8B2E4A` header with white-inverted logo as the portal — no auth elements, no sidebar
- **`<h1>`**: DM Serif Display (`fontFamily: 'var(--font-dm-serif)'`), `text-4xl`, color `#8B2E4A`
- **`<h2>` per section**: `text-xl font-semibold text-stone-800`
- **`<p>` body copy**: `text-stone-600 leading-relaxed`
- **Section spacing**: `space-y-10` between top-level `<section>` elements; `space-y-3` within each section
- **Inline links** (email, cross-refs): `text-[#8B2E4A] hover:underline`
- **Footer**: `border-t border-stone-200 mt-16 py-8`, flex centered with Privacy/Terms cross-links and copyright

**Sidebar footer links** (Privacy · Terms below sign-out): `color: rgba(255,255,255,0.25)`, transitions to `rgba(255,255,255,0.5)` on hover, `text-xs`, `<a>` tags (not `<Link>`). Separator dot at `rgba(255,255,255,0.15)`. Wrapped in `flex items-center justify-center gap-3 px-3 mt-3`.

### Billing AR Dashboard (`/billing`)

Read-only admin dashboard shipped in Phase 11B. Three views branch on `facilities.payment_type`.

- **Page shell**: `p-4 md:p-8 max-w-6xl mx-auto`; heading `text-2xl md:text-3xl` inline `style={{ fontFamily: 'DM Serif Display, serif' }}`; subtitle shows facility name + monospace `facilityCode` badge (`bg-stone-100 text-stone-500 font-mono text-[11px] px-1.5 py-0.5 rounded-md`).
- **Master-admin facility `<select>`**: right of header when `isMaster && facilityOptions.length > 1`. Rose focus ring (`focus:border-[#8B2E4A] focus:ring-2 focus:ring-rose-100`). Options labeled `"{facilityCode} · {name}"` when code exists.
- **Totals card** (`bg-white rounded-2xl border border-stone-100 shadow-sm p-5`): three `<StatCard>` tiles in `grid-cols-1 md:grid-cols-3 gap-3` — Total Billed / Total Received / Outstanding. `<StatCard highlight="amber">` flips the background to `bg-amber-50` and value text to `text-amber-700 font-bold text-xl` when outstanding > 0. Rev-share note appears below as muted `text-xs text-stone-500` only for RFMS/hybrid/legacy-facility payment types.
- **Disabled action buttons** (`<DisabledActionButton>`): burgundy `bg-[#8B2E4A] text-white` at `opacity-40 cursor-not-allowed` with `disabled` attribute and `title` tooltip explaining the future phase. Always rendered above the primary view and on the RFMS checks card.
- **IP view**: 12-col grid table — Resident(3) / Room(1) / Last Service(2) / Billed(1) / Paid(1) / Outstanding(2) / Last Sent(2). Outstanding > $0 in `text-amber-700 font-semibold`; $0 in `text-stone-500`. Row uses `md:grid md:grid-cols-12 md:gap-4 md:items-center flex flex-col gap-1.5 px-5 py-3.5 border-b border-stone-50 last:border-0` — stacks vertically on mobile. Empty state: "No residents set up for this facility yet."
- **RFMS view**: rose-50 rev-share note card (`bg-rose-50 border border-rose-100 text-rose-900 px-4 py-3 rounded-2xl`) + Checks Received table (Date / Check# / Amount / Memo-or-Invoice-Ref, 2/3/2/5 cols) + Per-Resident Breakdown table (Resident(4) / Room(1) / Last Service(2) / Billed(2) / Outstanding(3)). Each table sits in its own card with a header row.
- **Hybrid view**: two stacked `<section>` blocks (IP Residents + RFMS Residents), each with its own outstanding total inline in the heading. RFMS section gets its own 3-tile mini StatCard row (Resident count / Check count / Outstanding) before the RFMS view renders. Filters: IP = `residentPaymentType === 'ip'`; RFMS = everything else. Invoices/payments partitioned by `residentId` into each section (null-residentId invoices/payments flow into RFMS).
- **Loading skeleton**: two stacked `animate-pulse bg-stone-100 rounded-2xl` blocks (h-24 above h-64).
- **Empty state**: single card "No billing data yet. Import historical data from the Super Admin panel." when `invoices.length + payments.length === 0`.

Sidebar nav entry lives between Reports and Payroll, admin-only, inline SVG (receipt with `$` glyph). No mobile-nav entry — the 5-icon bottom bar is full.

### Animation System (Phase 11C.5)

Shared motion vocabulary lives in `src/lib/animations.ts`. Import the constants — never re-declare raw transition classes elsewhere.

- **`btnBase`** — `transition-all duration-150 ease-out active:scale-[0.97]`. Baseline press feel; no hover-scale. Already folded into `src/components/ui/button.tsx`.
- **`btnHubInteractive`** — adds `hover:scale-[1.02]` on top of `btnBase`. **Billing hub only** (pill toggles, prominent stat interactions). Do not apply hover-scale to dense UI (lists, table rows, sidebar items).
- **`cardHover`** — `transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md`. Clickable card lift.
- **`transitionBase`** — `transition-all duration-150 ease-out`. For simple color/bg hovers and chevron rotation.
- **`expandTransition`** — `transition-[max-height,opacity] duration-300 ease-out overflow-hidden`. Paired with inline `style={{ maxHeight: open ? '5000px' : '0px', opacity: open ? 1 : 0 }}`.
- **`modalEnter`** — `animate-in fade-in slide-in-from-bottom-3 duration-200`. Matches the shared Modal entrance; reuse when a surface needs the same feel.
- **`successFlash`** — `animate-in fade-in duration-150`. Wrap a transient save button / confirmation message that briefly appears.
- **`shimmer`** — references the `.skeleton-shimmer` class in `globals.css` (single source of truth). Always use `className="skeleton-shimmer rounded-2xl h-N"` for skeleton loaders; do NOT inline `animate-pulse bg-stone-100`.

**`useCountUp(target, duration=600)`** (`src/hooks/use-count-up.ts`) — animates integer values via `requestAnimationFrame` + easeOutCubic. Initial `value` seeds to `target` so SSR output matches first client render (no hydration mismatch). Honors `prefers-reduced-motion: reduce` (jumps straight to target). Call one hook per animated number at the top level of the component.

**`<ExpandableSection title meta defaultOpen children>`** (`src/app/(protected)/billing/views/expandable-section.tsx`) — accordion wrapper used by all billing views. Header row: `bg-white rounded-2xl border border-stone-100 shadow-sm`, hover `bg-stone-50`; chevron `rotate-180` when open. Max-height cap is **5000px** — fits hundreds of rows; worst case is a scroll cut-off which is acceptable vs JS-measured heights.

### Billing Hub Card (Phase 11C.5)

`billing-client.tsx` now renders one unified hub card per facility (replaces the flat totals+buttons stack).

- **Cross-facility summary bar** (master admin only, above facility selector): `grid grid-cols-2 md:grid-cols-4 gap-3 mb-6`. Four cards (Total Outstanding / Collected This Month / Invoiced This Month / Facilities Overdue), each `bg-white rounded-2xl border border-stone-100 shadow-sm p-4 ${cardHover}`. Numeric values wrapped in `useCountUp`. Amber tint when outstanding > 0; emerald tint on collected; red when facilities overdue > 0. Loading: 4 `skeleton-shimmer rounded-2xl h-20`.
- **Hub card** (`bg-white rounded-2xl border border-stone-100 shadow-sm p-6 mb-4`):
  - Top row: facility name (DM Serif Display) + `facilityCode` mono badge + payment-type pill (`IP`/`RFMS`/`Hybrid` → `bg-stone-100 text-stone-700 rounded-full px-2 py-0.5 text-xs font-semibold`). Right side: Send Statement button with inline spinner during `sendLoading`, success toast on send.
  - Stat row: 3 tiles in `grid grid-cols-1 md:grid-cols-3 gap-3 mt-5`, each value wrapped in `useCountUp` → `formatDollars`. Amber highlight on Outstanding when > 0.
  - Rev-share row (only `paymentType ∈ {rfms, facility, hybrid}`): `mt-5 pt-5 border-t border-stone-100`. Label `text-xs font-semibold text-stone-500 uppercase tracking-wide`. Two pill buttons (Senior Stylist / Facility) — active pill is burgundy `bg-[#8B2E4A] text-white`, inactive is `bg-stone-100 text-stone-600 hover:bg-stone-200`. Both use `btnHubInteractive` (hover-scale allowed here). Save button appears only when `pendingRevShare !== null && pendingRevShare !== current`, wrapped in `successFlash`. Success toast on save; error toast on failure.
- **Payment-type views** are now `<ExpandableSection>` wrappers:
  - **`IPView`** — single section, default open. Meta: `"N residents · K with balance"`.
  - **`RFMSView`** — two sections, both default closed. Meta examples: `"N checks · $X received"`, `"N residents · $X outstanding"`. Rose-50 rev-share notice REMOVED (hub card replaces it).
  - **`HybridView`** — delegates to `IPView` (title="IP Residents", open) + `RFMSView` (residentsTitle="RFMS Residents", checksTitle="RFMS Checks received", both closed). All three accept optional `title`/`defaultOpen` overrides so hybrid can rename/recolor without duplicating internals.

### Billing Polish Patterns (Phase 11C.6)

**Money formatting — always `Intl.NumberFormat`**. `formatDollars(cents)` in `billing-shared.tsx` is a module-level singleton (`new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })`). Never re-implement with string concat — `Intl` handles thousands separators (`$316,796.94`) and negative signs (`-$1,234.56`) automatically.

**Date range pill toggle** (billing hub card): row of 4 rounded-full pills (`rounded-full px-3 py-1 text-xs font-semibold`), reuses `btnHubInteractive`. Active pill: `bg-[#8B2E4A] text-white`; inactive: `bg-stone-100 text-stone-600 hover:bg-stone-200`. Periods: **Month** (default) / **Year** / **Custom** / **All**. `Custom` opens an inline popover below the row (`mt-2 inline-block bg-white border border-stone-200 rounded-2xl shadow-lg p-4` + `modalEnter`) with From/To `<input type="date">` + Apply button. Invalid range (`from > to`) blocks apply with a toast; no fetch fires. Dates are formatted via `toISODate()` helper using local-tz components to avoid UTC drift.

**Sortable table columns** (IP residents + drill-down reports): reuse the `SortHeader` idiom — header cells become `<button>`s with `↕/↑/↓` glyph. Inactive arrow: `text-stone-300`. Active: `text-stone-700`. Click same header again → flip direction. Null values sort last regardless of direction. String columns use `localeCompare` (pass `{ numeric: true }` for room numbers). Cross-reference: services page, residents page, directory page — same pattern across the app.

**Slide-over drawer** (cross-facility drill-downs): `fixed inset-y-0 right-0 w-full max-w-2xl bg-white shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-300`. Backdrop is a separate sibling at z-40 (`fixed inset-0 bg-black/30`, onClick → close). Escape key closes via `useEffect` keyed on `onClose`. Structure: sticky header (DM Serif Display title + close ×), `flex-1 overflow-y-auto` body, sticky footer with "View Full Report →" `<Link>`. Rows are `<button>`s (whole-row clickable, `hover:bg-stone-50`). Use this pattern when a dense list needs to appear without leaving the current page.

**Deep-link via query param**: `/billing?facility=ID` is supported. `billing-client.tsx` reads `useSearchParams()` inside the initial state callback and only overrides `initialFacilityId` when the ID exists in `facilityOptions`. Whenever you use `useSearchParams()` inside a client component rendered by a server-component `page.tsx`, wrap the client in `<Suspense fallback={null}>` in `page.tsx` per Next.js 16 requirements.

**Full-report drill-down pages** (`/billing/{outstanding,collected,invoiced,overdue}`): master-admin-only server components redirecting non-masters to `/billing`; render a shared `CrossFacilityReportClient` client component. Header: `← Back to Billing` (left) + "Download CSV" button (right). Full sortable table below. CSV export is client-side only (`new Blob([csv], { type: 'text/csv;charset=utf-8' })` + `URL.createObjectURL` + programmatic `<a download>`); reflects the CURRENT client-side sort. Row click → `router.push('/billing?facility=' + id)`.

**Year subheader pattern** (RFMS checks list): when rendering a DESC-sorted list of dated rows, insert a year heading above the first row of each year via `Fragment` + `let lastYear: number | null = null`. The subheader is a sibling `<div>` (not a wrapper) styled `text-xs font-bold text-stone-400 uppercase tracking-widest` on `border-b border-stone-50`. Works in both `<table>`-based and `<div>`-grid-based lists.

### Check Scanning Patterns (Phase 11D)

**Scan Check button** (billing hub, next to Send Statement): `${btnBase} inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold bg-stone-100 text-stone-700 hover:bg-stone-200`. Inline 16×16 camera SVG via `<svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">` — matches the outlined-icon language of the rest of the hub. Button placement is intentionally stone-colored (not burgundy) so Send Statement remains the primary action.

**Camera vs file input**: a single `<input type="file">` with `accept="image/jpeg,image/png,image/webp,image/heic,image/heif"` and `capture="environment"` works for both desktop file picker and mobile camera. The `capture` attribute is a hint — desktop browsers ignore it, mobile browsers honor it. No `md:hidden` branch needed if a single picker is sufficient; split into "Take Photo" + "Choose File" buttons only when the UX needs both visible simultaneously.

**Two-column confirmation layout** (scan-check modal Step 2): grid `grid-cols-1 md:grid-cols-2 gap-6`. Left = check image in `max-h-[540px] overflow-y-auto` scroll container. Image is wrapped in `<button type="button" className="w-full cursor-zoom-in">` with a "Click to enlarge" caption below — clicking sets `lightboxOpen = true`. Right = form fields vertically stacked. On mobile, image collapses above the form (single column).

**Check image lightbox**: a `z-[60]` full-screen overlay (`fixed inset-0 bg-black/90 flex items-center justify-center p-4 cursor-zoom-out`) renders as a sibling to `<Modal>` in the component's return — requires a `<>...</>` fragment wrapper. Click backdrop to close; `onClick={(e) => e.stopPropagation()}` on the `<img>` prevents accidental close. X close button: `absolute top-4 right-4 text-white bg-black/50 rounded-full w-8 h-8 flex items-center justify-center`. `lightboxOpen` state is reset to `false` in `resetEditState()` so it clears between scans.

**Low-confidence field highlight**: fields from OCR marked `confidence: 'low' | 'medium'` wrap in `bg-amber-50 border-amber-200 rounded-lg`. High-confidence fields use the default stone styling. Gives admins an at-a-glance "verify this" signal without blocking save.

**Total-accuracy validation**: when the sum of line items + cash-also-received doesn't equal the check total, show an inline red validation message above the save button: `Line items total $X but check amount is $Y — adjust before saving.` "Record Payment" stays disabled until the equation balances. "Save as Unresolved" remains enabled — unresolvable is always an escape hatch.

**Invoice match banners** (below resident lines in confirmation modal):
- `high` (exact open-balance match): `bg-emerald-50 border-emerald-100 text-emerald-800` with "Matches open balance exactly (${amount})".
- `partial` (total open balance > check amount, no exact match): `bg-amber-50 border-amber-200 text-amber-800` with "Partial payment — $X of $Y total. $Z will remain outstanding."
- `none`: `bg-stone-50 border-stone-200 text-stone-600` "No matching invoice found — payment will be recorded as unattributed".

**Unresolved banner** (per-facility billing hub): `px-4 py-2.5 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-between mb-4`. Left: `text-sm text-amber-800` with `⚠ {N} unresolved scan{s}`. Right: `${btnBase} text-sm font-semibold text-amber-900 hover:underline` "Review →" button that opens the unresolved panel.

**Red-tinted stat card variant** (5th master card when unresolved count > 0): `bg-red-50 border-red-100` shell + `text-red-700` label + `text-red-700` value. Same animation contract as the other 4 cards (`useCountUp` + `cardHover`). Flips to default `bg-white border-stone-100` when count is 0 — tinting is reserved for "needs attention right now" state.

**Modal mount stacking**: `ScanCheckModal` lives alongside `SendDedupModal` and `CrossFacilityPanel` in `billing-client.tsx`. All three are z-50 overlays; they never stack (only one is open at a time, enforced by the panel's `onResolveUnresolved` callback which closes the panel before opening the modal).

**Invoice Lines table** (scan-check modal Step 2, RFMS_REMITTANCE_SLIP only): `bg-stone-50 rounded-2xl p-4 border border-stone-100`. Header row: `grid grid-cols-[auto_1fr_auto] gap-x-4 text-xs text-stone-400 font-semibold uppercase tracking-wide`. Each line: same grid, `py-1 text-sm`; `confidence === 'low'` rows get `bg-amber-50`. Total row: `border-t border-stone-200 mt-2 pt-2 flex items-center justify-between text-sm`. Total value: `text-emerald-700 font-bold tabular-nums` when matches extracted check amount, `text-red-600` otherwise with ` ≠ check amount` suffix.

**Expandable check detail row** (rfms-view.tsx, remittance checks only): Check # cell renders as `${btnBase} text-stone-700 underline decoration-dotted hover:text-stone-900` button when `residentBreakdown.type === 'remittance_lines'`; plain text otherwise. Expanded detail is a sibling `<div>` (not inside the payment row) with `${expandTransition} px-5 py-3 bg-stone-50 border-b border-stone-100`. Three-column grid: `grid-cols-[6rem_1fr_6rem]` — Ref # (font-mono xs), Date, Amount (text-right tabular-nums). Total row at bottom: emerald when matches `p.amountCents`, amber otherwise. Single-open-at-a-time via `expandedCheckId` state; clicking an already-open row collapses it.

---

## UI Polish Overhaul v2 (2026-04-23)

A visual-only pass — zero logic changes — to make the app feel like a premium admin tool. The patterns below are the new house style; older sections in this doc still reference the previous looser conventions and will be reconciled as surfaces are touched.

### Shadow tokens

Four CSS variables on `:root` in `globals.css` — use via `shadow-[var(--shadow-*)]`. Do NOT roll custom shadows inline.

```css
--shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06);
--shadow-md: 0 4px 10px rgba(15, 23, 42, 0.06), 0 2px 4px rgba(15, 23, 42, 0.04);
--shadow-lg: 0 12px 28px rgba(15, 23, 42, 0.10), 0 4px 10px rgba(15, 23, 42, 0.05);
--color-panel-bg: #FDFCFB;  /* warm off-white for side panels */
```

### TopBar (`src/components/layout/top-bar.tsx`)

Desktop-only horizontal bar (48px) above main content. Hidden on mobile (`hidden md:flex`).

- Container: `h-12 shrink-0 items-center gap-2 px-5 border-b border-stone-200 bg-white/80 backdrop-blur-sm`
- Three page tabs (Calendar / Residents / Daily Log) — role-filtered. Active state is an **underline** via `after:absolute after:left-2 after:right-2 after:-bottom-[13px] after:h-[2px] after:bg-[#8B2E4A] after:rounded-full`. Inactive: `text-stone-500 hover:text-stone-800`.
- Facility chip: `h-8 px-3 rounded-full border border-stone-200 bg-stone-50 text-xs font-medium text-stone-700 inline-flex items-center gap-2`. Shows `{facilityCode} · {facilityName}`.
- New Booking button (admin-only, `size="sm"`) → `router.push('/dashboard?new=1')`. Dashboard reads the param via `useSearchParams()` in a `useEffect`, opens the existing `NewBookingModal`, then strips the param via `router.replace('/dashboard')`.
- Lives inside `<main>` as `shrink-0`. The children below it are wrapped in `flex-1 min-h-0 overflow-auto` so nested `h-full` layouts (dashboard) work correctly.

### Sidebar section labels (`src/components/layout/sidebar.tsx`)

Nav items are split at definition time into three labeled groups:

- **SCHEDULING** — Calendar, Daily Log, My Account
- **MANAGEMENT** — Residents, Stylists, Directory, Services, Settings
- **ANALYTICS** — Billing, Analytics, Payroll

Each group renders under a section label: `text-[10px] tracking-[0.14em] uppercase text-white/35 px-4 mt-3 mb-2 font-medium`.

**Active nav pill:** `bg-[#8B2E4A]/30 text-white font-semibold shadow-inner` + icon `text-[#E8A0B0]`.
**Inactive:** `text-white/70 hover:bg-white/5`.
**Radial accent overlay:** wrap `<aside>` inner content in `relative overflow-hidden` with a non-interactive background layer:

```tsx
<div aria-hidden className="pointer-events-none absolute inset-0"
     style={{ background: 'radial-gradient(1200px 400px at -10% 0%, rgba(196,104,122,0.14), transparent 60%)' }} />
```

### Dashboard Today gradient card (right panel top)

Inserted at the TOP of the dashboard right panel, above "Who's Working Today" (admin-only; coexists with existing cards).

```tsx
<div className="rounded-2xl p-5 text-white shadow-[var(--shadow-md)]"
     style={{ background: 'linear-gradient(135deg, #8B2E4A 0%, #6B2238 100%)' }}>
  <div className="text-[11px] uppercase tracking-wide text-white/70 font-medium">Today</div>
  <div className="text-3xl font-serif mt-1">{format(new Date(), 'EEEE, MMM d')}</div>
  <div className="grid grid-cols-2 gap-2 mt-4">
    {/* 2×2 stat pills — frosted glass */}
  </div>
</div>
```

**2×2 stat pills inside the gradient card** use `bg-white/10 backdrop-blur-sm rounded-xl p-3` with `text-[11px] uppercase tracking-wide text-white/70` labels and `text-lg font-semibold text-white` values. Stats read from existing dashboard state (no new queries).

### View-switcher pill group (dashboard calendar + right panel tabs)

Replaced the old dense border buttons with a compact pill group:

```tsx
<div className="inline-flex h-9 rounded-xl border border-stone-200 bg-white p-0.5 shadow-[var(--shadow-sm)]">
  <button className="h-8 px-3 rounded-lg text-sm font-medium ...">
    {/* active: bg-stone-900 text-white shadow-sm; inactive: text-stone-600 hover:text-stone-900 */}
  </button>
</div>
```

### Table chrome (house style for CSS-Grid "tables")

All grid-based tables (residents, stylists, directory, payroll list + detail, billing IP/RFMS/cross-facility, super-admin facility list) share:

- **Outer wrapper:** `rounded-[18px] border border-stone-200 bg-white overflow-hidden shadow-[var(--shadow-sm)]`
- **Header row:** `bg-stone-50/60 border-b border-stone-200` with column labels in `text-[11px] font-semibold text-stone-400 uppercase tracking-wide`
- **Data row hover:** `group transition-colors hover:bg-[#F9EFF2]` — soft burgundy blush (rose-50-ish)
- **Persistent amber tint** (billing surfaces only, when `outstandingCents > 0` or equivalent): `bg-amber-50/40 hover:bg-amber-50/70` — OVERRIDES the blush hover. Reserved for "needs attention right now" rows.
- **Row action reveal:** action icons use `opacity-0 group-hover:opacity-100 transition-opacity` on row-level controls.

The old `text-xs font-semibold text-stone-500` header pattern is superseded by the lighter `text-[11px] … text-stone-400` above. Older surfaces still using `text-xs` headers should be migrated opportunistically.

### Primary button shadow + lift

`Button variant="primary"` now carries a soft burgundy shadow that grows on hover with a 1px lift:

```
shadow-[0_2px_6px_rgba(139,46,74,0.22)]
hover:shadow-[0_4px_10px_rgba(139,46,74,0.28)]
hover:-translate-y-[1px]
disabled:shadow-none disabled:translate-y-0
```

Secondary gets rose border + burgundy text on hover: `hover:border-[#C4687A] hover:text-[#8B2E4A]`.

### Badge base

All badges are now fully rounded capsules:

```
inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold
```

(was `px-2 py-0.5 rounded-md`). Hardcoded badge sites outside the `Badge` component (sort toggles in super-admin, facility chips in directory) should match this shape.

### Underline page-tab pattern (new standard — `pnav`)

**New design-system standard for page-level tab navigation** (top of a page, below the heading). NOT applied retroactively to existing pill-style tabs in this pass; use for any new tab surface going forward.

```tsx
<nav className="flex items-center gap-4 border-b border-stone-200">
  {tabs.map(t => {
    const active = pathname === t.href
    return (
      <Link
        key={t.href}
        href={t.href}
        className={cn(
          'relative py-3 text-sm font-medium transition-colors',
          active ? 'text-stone-900' : 'text-stone-500 hover:text-stone-800',
          active && "after:absolute after:left-0 after:right-0 after:-bottom-px after:h-[2px] after:bg-[#8B2E4A] after:rounded-full"
        )}
      >
        {t.label}
      </Link>
    )
  })}
</nav>
```

### h1 weight

DM Serif Display is already a heavy serif — `font-bold` crushes its counters. **All DM-Serif-Display-styled `<h1>` elements use `font-normal`**, not `font-bold`. Leave `<h2>`/`<h3>` untouched (those use DM Sans and benefit from `font-bold`).

## Motion & Interaction System (2026-04-24)

A coordinated pass to unify motion vocabulary, tighten interaction feedback, migrate remaining `alert()` calls, add empty states where primary surfaces had plain text, and give every page a subtle mount animation. Zero logic / API / schema changes.

### Motion tokens (globals.css)

```css
--ease-out:      cubic-bezier(0.25, 0.46, 0.45, 0.94);   /* Apple ease-out */
--ease-spring:   cubic-bezier(0.34, 1.56, 0.64, 1);      /* overshoot */
--ease-in-out:   cubic-bezier(0.4, 0, 0.2, 1);
--duration-fast: 100ms;
--duration-base: 160ms;
--duration-slow: 260ms;
--shadow-xl:     0 20px 48px rgba(0,0,0,0.12), 0 8px 16px rgba(0,0,0,0.06);
--surface-base:   #F7F5F0;
--surface-card:   #FFFFFF;
--surface-raised: #FFFFFF;
--surface-sunken: #F3F1EC;
```

### Global interaction baseline

```css
button, [role="button"], a {
  transition:
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out),
    transform var(--duration-fast) var(--ease-out),
    opacity var(--duration-fast) var(--ease-out);
}
button:active, [role="button"]:active {
  transform: scale(0.97);
  transition-duration: 60ms;
}
```

Do not layer extra `transition-all` / `transition-colors` classes on top unless you need non-default properties.

### Button polish

- Base: `focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8B2E4A]/30 focus-visible:ring-offset-2` — keyboard users see a soft burgundy halo; mouse clicks don't trigger it.
- Primary: `hover:-translate-y-[1.5px] hover:shadow-[0_6px_16px_rgba(139,46,74,0.32)]` + `active:shadow-none` (lift collapses on press).
- Secondary: `hover:bg-[#F9EFF2]/60 active:bg-[#F9EFF2]` (blush hover instead of stone).
- Ghost: `active:bg-stone-200 active:scale-[0.95]` (stronger press; overrides global 0.97).

### Card hover lift (`cardHover` in `src/lib/animations.ts`)

```
transition-[transform,box-shadow] duration-[160ms] ease-[cubic-bezier(0.25,0.46,0.45,0.94)]
hover:-translate-y-[2px] hover:shadow-[var(--shadow-md)]
```

Apply to standalone clickable cards (e.g. billing summary cards). NEVER apply to list rows or rows-inside-a-card — lifting a container inside another container breaks visually. For rows, use blush row-hover instead.

### Table row timing

All CSS-grid "tables" carry `transition-colors duration-[120ms] ease-out` on the row element for the blush sweep on hover. Applied on: residents list, stylist directory, applicants list, payroll list, payroll detail, ip-view billing rows, rfms-view billing rows, cross-facility-report rows, cross-facility-panel facility rows.

### Sidebar active pill

CSS-only animation — no framer-motion in the project. Link uses `transition-colors duration-150 ease-out`, icon span uses `transition-colors duration-150`. The burgundy `bg-[#8B2E4A]/30` pill crossfades in/out between route changes via background-color interpolation.

### Skeleton classes

Two parallel classes:

- `.skeleton` — lighter, faster (1.4s loop), `#F3F1EC → #EAE8E4` gradient. Used by `<Skeleton>` / `<SkeletonResidentRow>` / `<SkeletonBookingCard>` / `<SkeletonStatCard>` from `src/components/ui/skeleton.tsx`.
- `.skeleton-shimmer` — existing heavier variant, remains for billing-specific placeholders and any prior inline usages.

Prefer `.skeleton` for new ad-hoc shimmer shapes. Never `animate-pulse bg-stone-100`.

### Page-level mount animation

```css
@keyframes pageEnter {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.page-enter { animation: pageEnter var(--duration-slow) var(--ease-out) forwards; }
```

Add `className="page-enter"` (as a prefix, preserving existing classes) to the outermost div of each page client. Dashboard is excluded — its grid layout is custom and the animation would flash the calendar. Applied to: residents list, log, billing, payroll list, settings, my-account, stylist directory, stylist detail, resident detail.

### Toast system (refactor)

`useToast()` from `src/components/ui/toast.tsx` — method API:

```ts
toast.success('Saved')
toast.error('Network error')
toast.info('Heads up…')
toast.loading('Importing…')
// legacy form still works: toast('msg', 'success')
```

- Visual: white bg + colored border + colored icon (emerald checkmark / red X / stone info / stone spinner) + `shadow-[var(--shadow-lg)]`, `rounded-xl`, `min-w-[280px] max-w-[360px]`, text `text-sm font-medium`.
- Enter animation: 200ms ease-out. Exit: 160ms.
- Auto-dismiss at 3500ms for `success` / `info`. **`error` and `loading` do NOT auto-dismiss** — user must X out.
- Position: top-right on mobile, bottom-right on desktop.

Never use `alert()` or raw error divs for user-facing messages — existing `alert()` calls in `billing/views/ip-view.tsx` and `payroll/[id]/payroll-detail-client.tsx` have been migrated.

### Empty states (`<EmptyState>`)

Component at `src/components/ui/empty-state.tsx`:

```tsx
<EmptyState
  icon={<svg width="20" height="20" ...>…</svg>}
  title="No appointments today"
  description="Add a walk-in to get started."          // optional
  cta={{ label: '+ Add Walk-in', onClick: handleAdd }} // optional
/>
```

Layout: 48×48 tinted circle (`bg-stone-50`, `text-stone-400`) → title (`text-sm font-semibold text-stone-700`) → optional description (`text-xs text-stone-400`) → optional primary CTA button. Vertical stack, centered, `py-10 px-6`.

Applied to: residents list (refactor of previous inline impl), daily log (scissors-style sparkle icon + "+ Add Walk-in" CTA), dashboard services panel (scissors icon), dashboard stylists panel (person + star icon), dashboard residents panel (person + plus icon). Don't render bare "No X yet" text on primary surfaces.

### Focus ring standard

- All inputs/selects/textareas use `focus:ring-2 focus:ring-[#8B2E4A]/20`. Bulk-refactored from `focus:ring-rose-100` and `focus:ring-[#8B2E4A]/30` across 28 files.
- Wrapper components (`<Input>`, `<Select>`, `<NativeSelect>`) also soften the border to `focus:border-[#8B2E4A]/50` and use `transition-[border-color,box-shadow] duration-150 ease-out`.
- Inline inputs keep the solid `focus:border-[#8B2E4A]` (avoids touching button classnames that legitimately use the solid color).

### Search-input glow

Primary search inputs carry an additional `focus:shadow-[0_0_0_3px_rgba(139,46,74,0.08)]` halo on top of the ring. Applied on: residents list search, log resident search, stylist directory search, applicant directory search.

### Balance-attention pulse

```css
@keyframes attention {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.7; }
}
.balance-attention { animation: attention 2.5s ease-in-out infinite; }
```

**Reserved for outstanding-balance dollar figures in `ip-view.tsx` and `rfms-view.tsx` only**, applied conditionally when `outstandingCents > 0`. Never apply elsewhere — the class is a signal for "needs attention" money, not a general pulse utility.

### Reduced motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

All new animation must respect this — it sits at the bottom of globals.css so it wins on specificity ties.

---

## List Row Standards (2026-04-24)

Before this pass, every list/panel row used the same cramped recipe — 28px avatar, 14px name, 12px sub-text, a uniform rose-50 background on every avatar, and a decorative `›` chevron at the end. On a salon-ops app where most screens ARE lists (residents, stylists, appointments, billing, payroll), that meant every row looked identical and nothing pulled the eye down a column. This section standardizes the replacement.

### Avatar palette (`src/lib/avatar-colors.ts`)

`getAvatarColor(name)` maps the first letter of a person's name to one of six pastel `{ bg, text }` pairs, cycling across A–Z. Determined by the letter's char code; stable across renders.

```ts
const PALETTE = [
  { bg: '#EEEDFE', text: '#534AB7' }, // purple
  { bg: '#E1F5EE', text: '#0F6E56' }, // teal
  { bg: '#E6F1FB', text: '#185FA5' }, // blue
  { bg: '#F9EFF2', text: '#8B2E4A' }, // burgundy
  { bg: '#FAEEDA', text: '#854F0B' }, // amber
  { bg: '#EAF3DE', text: '#3B6D11' }, // green
]
```

The `<Avatar>` component automatically uses this when no explicit `color` prop is passed. Stylist rows that want the calendar color (log page, stylists panel) still pass `color={stylist.color}` to override.

### Row anatomy

- **Avatar:** `size='md'` (36px `w-9 h-9`, `text-[12px]`). Never `size='sm'` on list/panel rows anymore.
- **Name text:** `text-[13.5px] font-semibold text-stone-900 leading-snug`.
- **Sub-text:** `text-[11.5px] text-stone-500 leading-snug mt-0.5`.
- **Row padding:** `py-3.5` minimum. `px-4` in right-rail panels, `px-5` in full-page tables.
- **Status/facility chips:** `text-[10.5px] font-semibold px-2.5 py-1 rounded-full`. No more `text-[9px]` or `text-[10px]` chip sizing.
- **Row hover:** `hover:bg-[#F9EFF2] transition-colors duration-[120ms] ease-out`. Amber outstanding-balance tint (billing only) remains the one documented exception.
- **No trailing chevron.** The hover state already communicates interactivity. Disclosure-indicator chevrons (expand/collapse) are a different pattern and are unaffected.

Applied to: dashboard residents panel, dashboard stylists panel, residents list full page, daily log appointment rows (avatar replaces the leading status circle; status chip moves inline next to the name), stylist directory, billing IP view, billing RFMS view. Payroll list gets the text + chip + chevron cleanup but no avatar (rows are date ranges, not people).

### Mobile list variants

Desktop 4-column tables collapse uncomfortably on phones — avatars stay 36px, names truncate, and the "Total Spent" column is noise on a 375px viewport. The residents list is the first surface to get a dedicated phone layout: below the `md` breakpoint, rows render as vertical-flex cards with a 40px avatar (via `className="!w-10 !h-10"` override on `size='md'`), a 15px name that wraps to two lines (`break-words`, never `truncate`), a 12px subtitle combining room and POA (`Room 406 · POA on file` — the inline POA pill from the desktop layout is folded into text), a short-format last-service date (`Apr 24`) or a small `New` chip when the resident has no visits yet, and a trailing `›` chevron (a deliberate mobile-only affordance — desktop list rows remain chevron-free per the rules above). The "Total Spent" column is removed entirely on phones.

When the residents list is sorted by name ascending (the default), sticky single-letter section headers (`A`, `B`, `C`…) appear above each group under `bg-white/90 backdrop-blur-sm`. On other sort orders the headers are suppressed since they'd lose meaning.

Desktop and mobile renderings share the same outer card wrapper; branching is done via `hidden md:block` / `md:hidden` sibling divs. The wrapper drops `overflow-hidden` so sticky headers can escape, and the desktop inner div carries `overflow-hidden rounded-[18px]` instead to preserve grid-row clipping.

Other list surfaces (stylists, daily log, billing, payroll) currently render the Task A desktop treatment on both desktop and mobile — migrate them to a phone-specific card variant only if the same density issue recurs there.

## Debug Role Impersonation UI

The `DebugBadge` (`src/components/debug/debug-badge.tsx`) is a floating amber pill rendered in `(protected)/layout.tsx`. It reads `document.cookie` on mount for `__debug_role` and renders when the cookie exists.

- **Position**: `fixed top-4 right-4 z-[200]` — top-right corner, well above all other chrome including the TopBar; does NOT use `bottom` positioning (old bottom-right badge was retired in 2026-04-26 fix)
- **Color**: `bg-amber-400 text-amber-950 border-2 border-amber-500` — high-contrast amber
- **Shape**: `rounded-2xl px-3 py-2 text-xs font-bold shadow-xl`
- **Content**: "Debug" uppercase label + "{role} · {facilityName}" in bold + "← Exit to Super Admin" button
- **Reset**: POSTs `/api/debug/reset`, then `window.location.href = '/super-admin'` (hard redirect, not `router.refresh()`) — ensures server re-reads cleared cookie before rendering
- **No `useRouter`** — removed; `window.location.href` is the correct escape pattern here

**Anti-pattern — do NOT revert to:**
- Bottom-right position with `style={{ bottom: 'calc(...)' }}` — competes with mobile nav
- `z-50` — too low, can be occluded by modals
- `router.refresh()` — doesn't guarantee a clean server re-render after cookie clear
- `rounded-full` small pill with `×` button — not prominent enough as an escape hatch

Sidebar amber chip (when `debugMode` prop is true):
```tsx
<div className="mt-1.5 px-2.5 py-0.5 rounded-full bg-amber-400/20 text-amber-300 text-[10px] font-semibold text-center">
  DEBUG MODE
</div>
```
Rendered below the facility name / facility switcher in `sidebar.tsx`.

**Super Admin nav link gating** — the Super Admin link in `sidebar.tsx` is gated on BOTH the email check AND `!debugMode`. When impersonating, the link must be hidden so the simulated role is fully faithful:
```tsx
{process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL && user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL && !debugMode && (
  // Super Admin nav link
)}
```

The Debug tab (`src/app/(protected)/super-admin/debug-tab.tsx`) is the last tab in the Super Admin page. Uses the same `bg-white rounded-2xl border border-stone-200 p-5 shadow-sm` card style as other super-admin cards. Action buttons use the standard burgundy button with hover color swap.

**Debug tab status block** — always rendered at the top of the tab (before the facility picker), showing current mode:
- When impersonating: amber dot + "{role} · {facilityName}" + "Reset to Super Admin" button
- When normal: emerald dot + "Super Admin (normal)" — no button
- Uses `document.addEventListener('visibilitychange', readCookie)` so the status updates when the browser tab regains focus (e.g., returning from impersonation session)

`MobileNavProps` accepts `debugMode?: boolean` (currently unused — mobile nav has no Super Admin link — but passed for API consistency).

## Family Portal Layout (`/family/[facilityCode]/*` — Phase 11I)

The family portal at `/family/[facilityCode]/*` is the POA-facing surface — magic-link auth, one account → many residents, mobile-first. It coexists with the legacy single-resident `/portal/[token]` route.

**Shell** (`layout.tsx`):
- Background: `bg-[#FDF8F8]` (pale rose tint, matches the resident portal palette).
- Top header: `bg-[#8B2E4A]` with the same inline floral SVG accent used on the legacy portal (`rgba(255,255,255,0.15)` stroke, top-right anchored). Senior Stylist logo wrapped in `<Image>` with `filter: brightness(0) invert(1)` (white on burgundy).
- Header right side: resident picker `<select>` (only when `residents.length > 1`) writes `?residentId` via `router.replace`. "Sign out" link → POST `/api/portal/logout` → `window.location.href = '/family/[code]/login'`.
- Main content: `max-w-[640px] mx-auto px-4 pt-4` with bottom padding `paddingBottom: 'calc(env(safe-area-inset-bottom) + 96px)'` to clear the bottom nav + home indicator.
- Login pages (`/login`, `/auth/verify`) render WITHOUT the header chrome and bottom nav.
- Whole tree wrapped in `<ToastProvider>` so client pages can call `useToast()`.

**Bottom navigation** (`portal-nav.tsx`, client component):
- Fixed `bottom: 0`, full-width, `backdrop-blur` white background, `paddingBottom: 'env(safe-area-inset-bottom)'`. Visible at all widths (no `md:hidden`).
- Five tabs: Home / Appointments / Request / Billing / Contact. Inline SVG icons.
- Active state via `usePathname()` — burgundy `text-[#8B2E4A]` + heavier weight; inactive `text-stone-500`.

**Login UX** (`login/login-client.tsx`):
- Two tabs: `Email me a link` (default) and `Sign in with password`. Underline `pnav` pattern — active tab gets a `#8B2E4A` underline bar.
- Email tab: input → POST `/api/portal/request-link` → confirmation card "Check your email — link expires in 72 hours." (Always shown, regardless of whether the email matched.)
- Password tab: email + password → POST `/api/portal/login` → `router.push('/family/[facilityCode]')` on success.
- Both forms display generic error text only — never "user not found" / "wrong password" distinctions.

**Magic-link verify** (`auth/verify/page.tsx` + `verify-set-password.tsx`):
- Server component verifies token, sets `__portal_session` cookie via `cookies().set(...)`, then renders a small client form: "Want to set a password for faster sign-in next time?" with `[Skip]` and `[Set password]` buttons. Skip → `router.push('/family/[code]')`.
- On verification failure: error card with "Request a new link" CTA.

**Home page** (`page.tsx`):
- Greeting card: `Hi, {emailLocal} — here's {residentName}`.
- Outstanding-balance callout: amber bg + `.balance-attention` pulse class when `qbOutstandingBalanceCents > 0`; emerald "All paid up!" otherwise.
- Upcoming appointments: next 3 (date · time · service · stylist). Status badges: `requested` → amber "Pending approval"; `scheduled` → blue.
- CTA button: "Request a service" → `/family/[code]/request`.

**Appointments** — two sections (Upcoming, Past 6 months) with `<EmptyState>` fallbacks.

**Request booking** (`request/request-client.tsx`) — three stacked sections (services / preferred date / notes), no wizard. Service picker uses `sortCategoryGroups` + `sortServicesWithinCategory` and filters out `pricingType === 'addon'`. Multi-select capped at 6. Notes textarea `maxLength={2000}`. Success card with "Make another" + "Back to home".

**Billing** (`billing/billing-client.tsx`) — outstanding balance header (`.balance-attention` pulse only when > 0), "Pay online" section (visible only when Stripe key exists AND balance > 0) → POST `/api/portal/stripe/create-checkout` → `window.location = checkoutUrl`. Always-shown mail-payment block: "Or pay by check: Senior Stylist, 2833 Smith Ave Ste 152, Baltimore MD 21209 · 443-450-3344 · pmt@seniorstylist.com". Invoice list + "Download statement" anchor → `/api/portal/statement/[residentId]` (opens in new tab; user invokes browser print). Reads `?payment=success` on mount → success toast → `router.replace` to strip the param.

**Statement (printable HTML)** — `/api/portal/statement/[residentId]` returns HTML with embedded `@media print` CSS that hides the print button + back link, and a header `<button onclick="window.print()">Print or Save as PDF</button>`. NO PDF dependency — user uses browser's native "Save as PDF".

**Resident detail unified "Family Portal" card** — admin-only (gate: existing admin-page guard). Single card replaces the former "Family Portal" (send-invite only) + "Portal Link" (token copy/send) dual-card setup. Layout: label row + description + optional POA email display + two equal-width buttons side by side. **Send Link** button: burgundy primary, fires `/api/portal/send-invite`, toast on success, refreshes. Label flips to "Sent Nh ago" during the 24h cooldown. **Copy Link** button: stone secondary, calls `/api/portal/create-magic-link`, copies returned URL to clipboard, shows "✓ Copied!" for 3s. Both buttons disabled + `disabled:opacity-40` when `!resident.poaEmail`. No tooltip needed — amber "No POA email on file" message is shown above the buttons when email is absent.

