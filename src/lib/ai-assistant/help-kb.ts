// P41 — the assistant's help knowledge base. Hand-authored, server-only:
// the explain_feature tool keyword-matches these guides and returns the body
// verbatim so the model can walk users through real workflows in detail
// (the pre-P41 assistant could only say "that's on the Daily Log page").
//
// Authoring rules:
// - USER-facing language only: page names, button labels, what they'll see.
//   Never code identifiers, file paths, or internal phase names.
// - Role-aware: note where admins/stylists/bookkeepers/front desk differ.
// - Keep each body a complete, self-contained walkthrough — the model quotes
//   and summarizes from it across follow-up turns ("give me more detail").
// - When a feature changes, update its guide IN THE SAME commit (same rule
//   as the Help Center tours).

export type KbRole = 'admin' | 'facility_staff' | 'bookkeeper' | 'stylist' | 'master'

export interface HelpGuide {
  id: string
  title: string
  /** Lowercase match words — supplement the title, don't repeat it. */
  keywords: string[]
  /** Omit = every role. When set, other roles don't get this guide. */
  roles?: KbRole[]
  body: string
}

export const HELP_GUIDES: HelpGuide[] = [
  {
    id: 'daily-log',
    title: 'Daily Log — recording and reviewing a day',
    keywords: ['log', 'day', 'record', 'daily', 'sheet', 'visits', 'finalize', 'notes', 'done', 'no show', 'paid'],
    body: `The Daily Log (the "Log" tab) is the running record of one day at one facility.

What's on it:
- Every appointment for the selected date, grouped by stylist. Use the ‹ › arrows next to the date to move between days.
- Each row shows the resident, room number, service, price, and status.

Recording work:
- Tap "Done" on a row when the service is finished, or "No-show" if the resident didn't come. These update instantly.
- Tap the payment chip to cycle unpaid → paid → waived. "$ due" (amber) means unpaid; "✓ paid" (green) means settled.
- Tap a row to open the edit form: change the service (or add a brand-new one with "➕ New service"), price, tips, notes, payment type, date, room number, and (admin/bookkeeper) the stylist.
- "Add Walk-in" records a service that wasn't scheduled — pick or create the resident, choose the service, done.
- The camera button on a completed row saves a style photo to the resident's gallery (optionally shared with the family).

Finalizing: stylists tap "Finalize day" when their section is complete — it locks their rows. Admins and bookkeepers can still edit after finalizing (for corrections); stylists can't.

Other tools in the header: Email (send the formatted day log to any address), Export (Excel for bookkeeping), and the scan button for paper log sheets. Bookkeepers and the master admin also get a facility picker here to jump between communities.`,
  },
  {
    id: 'scan-log-sheet',
    title: 'Scanning a paper log sheet (photo → bookings)',
    keywords: ['scan', 'ocr', 'photo', 'picture', 'upload', 'paper', 'camera', 'import', 'log sheet', 'handwritten'],
    body: `You can photograph a handwritten log sheet and the app reads it into real bookings.

Steps:
1. On the Daily Log page, tap the scan button (camera icon).
2. Bookkeepers and the master admin first pick which facility the sheets belong to — the "Scanning sheets for facility" selector at the top. Get this right: the sheet's residents are matched against THAT facility's roster. (The app also reads the facility name printed on the sheet and warns you if it doesn't match, with a one-tap "Switch to…" fix.)
3. Take photos or upload images of each sheet (multiple pages fine). The AI reads resident names, rooms, services, prices, tips, and the stylist from the header.
4. Review screen: every row shows what was read. Matched residents/services are picked automatically; unmatched ones show "Will create new". You can fix any field, uncheck rows you don't want, set the payment type, and enter a mail subject per sheet.
5. Confirm to import. Each row becomes a completed booking on that day's log.

Who can scan: admins, bookkeepers, and stylists. A stylist's scan is always filed under their own name at their own facility.

Made a mistake? The day's log shows an "Undo & edit" banner for scanned imports — it rolls the whole batch back and reopens the review screen so you can correct the facility, stylist, or rows and re-import. Bookkeepers can also open Log Sheet History to move a batch to a different facility.`,
  },
  {
    id: 'walk-in',
    title: 'Walk-in appointments',
    keywords: ['walkin', 'walk', 'unscheduled', 'drop in', 'add visit', 'quick add'],
    body: `A walk-in is a service performed without a prior appointment — record it on the Daily Log.

1. Open the Daily Log for the right day and tap "Add Walk-in".
2. Resident: start typing the name. Pick a match, or if they're new, use "Create & Select" — enter the name and room and the resident is added to the facility with the booking in one step.
3. Service: pick from the list, or choose "➕ New service…" and type the name and price (useful when the catalog is missing something like "S/B Dry $45").
4. Save. The visit appears on the log as completed, ready for payment status.

Stylists: walk-ins you add are always recorded under your own name. Bookkeepers can add walk-ins too (it's the manual version of the log-sheet entry they already do). The assistant can also do this for you — just say "add a walk-in for Mrs. Smith, wash and set" and confirm.`,
  },
  {
    id: 'booking-calendar',
    title: 'Calendar — booking, moving, and cancelling appointments',
    keywords: ['book', 'appointment', 'schedule', 'calendar', 'reschedule', 'move', 'cancel', 'recurring', 'auto assign', 'stylist pick'],
    body: `The Calendar tab is where appointments are created and managed.

Creating: tap an open slot (or the New Booking button / the + on mobile). Pick the resident (or create one inline), the service, and the date/time. The stylist defaults to "Auto-assign (recommended)" — the app picks whoever is on schedule with the lightest load, honoring the family's preferred stylist when possible. You can also pick a specific stylist from the list; a manual pick works even when auto-assign says nobody is available.

Tips auto-fill from the resident's saved preference, and their usual service is pre-selected once a pattern exists.

Moving/cancelling: open the appointment and change the time, or cancel it. Cancelling frees the slot and (if the waitlist has a matching resident) alerts the office that someone could take it. If a cancelled visit was already paid, you'll get a warning first.

Recurring: appointments can repeat weekly — cancelling can apply to just one visit or all future ones.

Stylists see and manage only their own appointments; front desk and admins manage everyone's. The assistant can do all of this by voice or text: "book Mrs. Smith for a wash and set tomorrow at 10", "move her 2pm to 3", "put John in my next open slot" — every change asks you to confirm first.`,
  },
  {
    id: 'signup-sheet',
    title: 'Sign-Up Sheet — appointment requests without a time',
    keywords: ['signup', 'sign up', 'request', 'intake', 'queue', 'pending', 'pick time'],
    body: `The Sign-Up Sheet is a lightweight intake queue: front desk logs that a resident WANTS an appointment, without picking an exact time. Stylists convert requests into real bookings later.

Front desk / admin: open the Sign-Up Sheet from the dashboard, enter the resident (or create one inline), the service, an optional preferred date/time, and notes. The request is auto-assigned to the stylist scheduled for that day. A "Pending requests" section at the top shows everything facility-wide; the × cancels a request.

Stylists: pending requests appear in an amber panel above your calendar, with a badge on the Calendar tab counting them. Tap "Pick time →" to open the booking form pre-filled, choose a slot, and the request becomes a real appointment. On desktop you can also drag a request card straight onto the calendar.

The assistant can add requests too: "put Mrs. Horn on the sign-up sheet for a perm next week."`,
  },
  {
    id: 'waitlist',
    title: 'Waitlist — filling cancelled slots',
    keywords: ['wait', 'cancellation', 'opening', 'earlier', 'slot opened', 'fill'],
    body: `The waitlist catches residents who want an earlier or additional visit, and matches them when a slot frees up.

Adding: on the dashboard's Waitlist panel, tap "+ Add", pick the resident, optionally a service and preferred stylist, and set the date window they're available ("any time between the 1st and the 15th").

Matching: when an appointment is cancelled, the app checks the waitlist — if a pending resident's window covers the freed slot's date, the office gets a notification so they can offer the slot. Converting a waitlist entry opens the booking form pre-filled; booking it marks the entry done.

Admins and front desk manage the waitlist; the assistant can add to it ("add Adele Cohen to the waitlist for any day next week").`,
  },
  {
    id: 'checkin',
    title: 'Stylist check-in ("I\'m Here") and running late',
    keywords: ['check in', 'arrived', 'im here', 'late', 'delay', 'shift', 'push back'],
    roles: ['stylist', 'admin', 'master'],
    body: `Stylists tap "I'm Here →" on their dashboard when they arrive at a facility (the banner shows whenever they have appointments today and haven't checked in yet).

If you arrive after your first appointment was supposed to start, the app computes how late the day is running and offers to shift ALL your remaining appointments by that amount in one tap — e.g. arrive 25 minutes late, and every future booking today moves 25 minutes later. You can accept or skip.

Check-in is a stylist-only action by design — it's an on-site arrival attestation, so even the master admin can't do it for someone. Tapping "I'm Here" twice is harmless (it remembers the first check-in).`,
  },
  {
    id: 'residents',
    title: 'Residents — adding, editing, merging, photos',
    keywords: ['resident', 'client', 'senior', 'add person', 'room', 'poa', 'contact', 'duplicate', 'merge', 'photo', 'gallery', 'birthday'],
    body: `The Residents tab is the roster for the facility.

Adding: tap Add Resident, enter the name (room and phone optional). Residents can also be created inline while booking or adding a walk-in.

The resident's page holds: contact info and POA (family) details, date of birth (drives birthday reminders), care/style notes from the family, their service history and total spent, a style-photo gallery, tip preference, the account ledger (billing roles), and the Family Portal card for connecting relatives.

Duplicates: scanning and imports sometimes create doubles. The "Duplicates" button (admins and bookkeepers) finds likely pairs and merges them — the kept resident inherits EVERYTHING: bookings, billing history, portal access, saved cards, photos. The merge screen shows warnings before anything happens.

Room changes: just edit the room field — or fix it right on a daily-log row or scan review; the resident record updates.

No hard deletes: removing a resident deactivates them (history is preserved).

Stylists don't manage the roster, but can add a brand-new resident while recording a walk-in. The assistant can add residents, update rooms/phones/POA contacts, and answer "when was Mrs. Smith's last visit?"`,
  },
  {
    id: 'family-portal',
    title: 'Family Portal — connecting relatives',
    keywords: ['family', 'portal', 'poa', 'invite', 'magic link', 'qr', 'coupon', 'signup poster', 'relative', 'daughter', 'son'],
    roles: ['admin', 'facility_staff', 'bookkeeper', 'master'],
    body: `The Family Portal lets a resident's family see appointments, request services, pay balances, and set preferences — no app install, no password required (login is by email link).

Connecting a family:
- On the resident's page, the Family Portal card has "Send Link" (emails the POA a sign-in link) and "Copy Link" (share it yourself). Both need the POA email on file.
- Bulk: Settings → Family Portal shows a Portal Status panel — who's connected, who could be invited — with a one-tap "invite everyone".
- Self-serve: print the facility's QR poster (Settings → Family Portal) — families scan it and sign up themselves. Signups matching the POA on file connect instantly; others go to your approval queue in Settings.

What families can do: view upcoming visits and history (with shared style photos), request appointments (which land as requests for you to confirm), pay balances online, add funds, send a gift to another resident, set tip defaults, and record style/allergy notes that stylists see on the daily log. There's an English/Spanish toggle and a large-print mode.

Welcome coupons and per-facility toggles live in Settings → Family Portal.`,
  },
  {
    id: 'billing',
    title: 'Billing — invoices, payments, checks, statements',
    keywords: ['billing', 'invoice', 'owed', 'balance', 'outstanding', 'check', 'statement', 'memo', 'collected', 'aging', 'monthly'],
    roles: ['admin', 'bookkeeper', 'master'],
    body: `The Billing page is the money hub for a facility (admins, bookkeepers, and the master admin; bookkeepers and master can switch between facilities right on the page).

The facility card shows invoiced/collected/outstanding for the selected period, an aging strip (how old the open balances are), and an action toolbar:
- Monthly view: month-by-month breakdown — invoiced, services performed, collected, still owed — with per-resident and per-day detail.
- Scan Check: photograph a check or remittance slip; the AI reads the amount, facility, and per-resident lines, matches them, and records the payment. Unreadable ones are saved for manual resolution, never lost.
- Scan memos: reads free-text check memos ("Jean Hall $48 Alma Markley $48…") and proposes which residents/visits they pay for — you confirm before anything is applied.
- Send Statement: emails the facility their statement (with a confirmation prompt so a stray tap never sends).
- QuickBooks: sync invoices from QB and send via QB where connected.

Per-resident detail lives on each resident's page: the account ledger shows invoices, payments, credits, and a running balance, plus available credits you can apply to open invoices.

Rule of thumb the app enforces everywhere: revenue counts COMPLETED visits only, and tips are never mixed into facility revenue. Ask the assistant "who owes us the most?" or "how much does Mrs. Hall owe?" for instant answers.`,
  },
  {
    id: 'qb-imports',
    title: 'QuickBooks CSV imports (master admin)',
    keywords: ['quickbooks', 'qb', 'csv', 'import', 'customer', 'invoice history', 'received payments', 'unapplied', 'credits'],
    roles: ['master', 'bookkeeper'],
    body: `Master Admin → Imports → QuickBooks is the guided 5-step import for QB billing data. Run the steps in order:

1. Customer Contact List — links QB customers to residents (and fills POA contacts). Run this FIRST so later steps match by customer ID.
2. Invoice History ("Invoice List by Date", exported with "All Dates") — the authoritative open-balance sync. Always use All Dates: it also clears stale balances for invoices voided in QB.
3. Received Payments ("Invoices and Received Payments") — per-resident payment history. Re-importing is safe (no double counting).
4. Transaction Memos ("Transaction List by Customer") — enriches payments with memo text.
5. Unapplied Credits ("Customer Balance Detail", All Dates) — money QB received but never applied to an invoice. Review them at Master Admin → Unapplied Credits, where you can auto-match or manually apply credits to open invoices (then mirror the application in QB — the next Step 2 import re-syncs from QB).

Each importer shows exactly which QB report to export. Facility rows are matched by F-code; residents by QB customer ID, then name.`,
  },
  {
    id: 'payments-cards',
    title: 'Card payments — card on file, take a payment, autopay',
    keywords: ['card', 'stripe', 'charge', 'collect', 'autopay', 'saved card', 'tap to pay', 'pay link', 'refund', 'payment type'],
    roles: ['admin', 'bookkeeper', 'stylist', 'master'],
    body: `Ways money gets collected:

- Payment types on a visit: Cash, Check, Card, and ACH count as paid immediately. "Invoice", RFMS, COF, RA, or None mean the visit stays on the open balance until a payment covers it.
- Card on file: on a resident's page (billing roles), save a card — it's stored securely by Stripe, the app never sees the number. "Collect now" charges the saved card against the open balance; "Send payment link" emails/texts the family a secure pay page instead.
- Take a payment at the chair: stylists, admins, and bookkeepers can open "Take card payment" and have the family tap/enter their card on the phone right after a visit (optionally saving it for next time).
- Autopay: per facility (Settings → Billing) and per resident. It can charge automatically when a visit completes, or sweep balances nightly. Families are notified when autopay is turned on, every automatic charge emails a receipt, and there's a safety cap on automatic amounts. Failed charges alert the office and fall back to a pay link.
- Refunds: billing roles can refund a Stripe payment from the resident's ledger (two-tap confirm).

The assistant deliberately does NOT move money — charging, refunding, and statement sending stay human-only actions in the UI.`,
  },
  {
    id: 'payroll',
    title: 'Payroll — pay periods, commissions, tips',
    keywords: ['payroll', 'pay period', 'commission', 'tips', 'stylist pay', 'quickbooks bill', 'net pay'],
    roles: ['admin', 'bookkeeper', 'master'],
    body: `The Payroll tab turns completed visits into stylist pay.

1. "New Pay Period": pick the date range. The app gathers every stylist's completed visits, applies their commission percentage, and adds tips on top (tips are always the stylist's — never facility revenue).
2. The period detail shows each stylist's visits, gross revenue, commission, tips, deductions, and net pay. Where the facility has a revenue-share agreement, the split is shown per stylist.
3. Approve the period as you verify it (draft → approved → paid). Mark-all-paid is one tap.
4. Export a QuickBooks-compatible CSV, or — where QB is connected — push the period straight to QuickBooks as Bills (commission and tips as separate lines per stylist).

A stylist's own earnings (visits, revenue, estimated commission, month pace) live on their My Account page — and stylists can just ask the assistant "how much have I made this month?"`,
  },
  {
    id: 'stylists-team',
    title: 'Stylists & team — hours, time off, compliance, accounts',
    keywords: ['stylist', 'team', 'hours', 'availability', 'time off', 'vacation', 'coverage', 'compliance', 'license', 'insurance', 'link', 'invite stylist', 'commission'],
    roles: ['admin', 'facility_staff', 'master'],
    body: `The Stylists tab lists everyone who works at the facility; each stylist's page is their full record.

Weekly hours: the stylist page has an hours editor — set which days and times they work. These hours drive auto-assignment, open-slot search, and the sign-up sheet. Stylists edit their own on My Account; admins, franchise admins, and the master admin can edit anyone's. (Or tell the assistant: "set Senait's hours Monday to Friday 9 to 5" — unlisted days become days off, and it restates the whole week before you confirm.)

Time off: stylists request it from My Account (admins approve or deny); supervisors can file time off ON BEHALF of a stylist, which is pre-approved. Approved absences block those days from scheduling, and the coverage queue helps find a substitute.

Compliance: upload license, insurance, and background-check documents; admins verify them and the badge turns green. Email alerts fire 60 and 30 days before an expiry.

Commission and status: set the commission percentage and active status on the stylist page (feeds payroll).

Giving a stylist a login: send an account invite from their page, then make sure their login is LINKED to their stylist record (Settings → Team → Assign stylist). An unlinked stylist login sees an amber "ask your admin to link you" banner. If a stylist switches email addresses: Disconnect stylist, invite the new email, relink.`,
  },
  {
    id: 'services',
    title: 'Services — catalog, pricing, price-sheet import',
    keywords: ['service', 'price', 'catalog', 'menu', 'tiered', 'addon', 'price sheet', 'promote', 'reorder', 'category'],
    body: `The Services tab is the facility's menu of offerings and prices.

Adding: "Add Service" with a name, price, and duration. Pricing types beyond fixed: add-on (rides along another service), tiered (price varies by quantity), and multi-option (pick one of several variants).

Importing: admins can upload a price-sheet PDF/photo and the AI reads every line into services — review before saving. The master admin can bulk-import price sheets for many facilities at once (files are auto-routed by the facility name found in the document).

Ad-hoc services: when a bookkeeper or stylist creates a service while logging (e.g. "S/B Dry $45" from a walk-in), it's marked as a logging-only service so it doesn't appear on family-facing menus. Admins can review these at the bottom of the Services page and "promote" the real ones into the catalog with a proper price and category.

Organizing: drag services to reorder within a category, and drag category headers to reorder sections (desktop). Prices are edited any time — history keeps whatever price each past visit was actually charged.

Front desk (facility staff) can manage services too; billing and payroll stay admin/bookkeeper territory.`,
  },
  {
    id: 'settings-team-invites',
    title: 'Settings — facility setup and inviting teammates',
    keywords: ['settings', 'invite', 'teammate', 'add user', 'working hours', 'notifications', 'digest', 'timezone', 'general'],
    roles: ['admin', 'facility_staff', 'bookkeeper', 'master'],
    body: `Settings (bottom of the sidebar) is organized into sections:

- General: facility name, address, phone, working hours (bounds the calendar's bookable times), timezone.
- Team: invite teammates by email — pick their role (admin, front desk, bookkeeper, stylist) and the invite email carries a join link. The Sent Invites list shows delivery and open status; "Copy link" is the fallback if an email doesn't arrive. This is also where you link a teammate's login to their stylist record ("Assign stylist").
- Family Portal: self-signup toggle, QR poster, welcome coupons, portal approval queue, portal coverage panel.
- Billing & Payments: revenue-share settings, autopay mode, QuickBooks connection.
- Notifications: daily digest email and monthly facility report toggles.
- Advanced: tutorial/demo data cleanup.

Role visibility: admins see everything; front desk sees General (read-only); bookkeepers see Notifications. Bookkeeper invites aren't tied to one facility — the role has access to every community.`,
  },
  {
    id: 'roles-permissions',
    title: 'Roles — who can do what',
    keywords: ['role', 'permission', 'access', 'admin', 'front desk', 'bookkeeper', 'viewer', 'franchise', 'master', 'who can'],
    body: `The roles, from widest to narrowest:

- Master admin (the owner account): everything, across every facility — including the Master Admin dashboard, imports, merges, and the stylist directory. Can switch to any facility and act there.
- Franchise admin: like an admin, but across all the facilities in their franchise, with a Franchise dashboard.
- Admin: full control of their facility — scheduling, residents, services, billing, payroll, analytics, settings, team.
- Front desk (facility staff): scheduling, residents, sign-up sheet, services, signage — no money pages (billing/payroll/analytics).
- Bookkeeper: billing, payroll, analytics, log scanning and corrections across EVERY facility — but read-only on residents and no scheduling changes (they can add walk-ins and fix imported log data).
- Stylist: their own world only — their calendar, their daily log rows, their earnings, their profile/hours/time off. They can scan their own log sheets and add walk-ins (including brand-new residents).
- Family (portal): their own resident(s) only, via the Family Portal — no staff app access.

The AI assistant follows the same rules automatically: it can only see and change what YOU can.`,
  },
  {
    id: 'analytics-reports',
    title: 'Analytics — revenue, reports, and how numbers are counted',
    keywords: ['analytics', 'report', 'revenue', 'numbers', 'busiest', 'by service', 'by stylist', 'month', 'export report'],
    roles: ['admin', 'bookkeeper', 'master'],
    body: `The Analytics tab is the facility's monthly report: total revenue, appointment counts, revenue by service, by stylist, commissions, busiest days, and the full appointment list. A revenue-share card appears when the facility has a split arrangement.

How numbers are counted (consistent app-wide):
- Revenue = COMPLETED visits only. Scheduled or cancelled appointments never count as money earned.
- Tips are the stylist's — never included in facility revenue.
- Days and months follow the FACILITY's timezone.

The "Ask AI" card at the top answers questions directly from your real numbers — "what was our best service last month?", "who owes us the most?" — and can drill into any facility for the master admin.

Exports: the Export button produces the bookkeeper-format Excel of daily logs for any facility set and date range. The master admin also gets network-wide reports on the Master Admin page.`,
  },
  {
    id: 'exports',
    title: 'Excel exports of daily logs',
    keywords: ['export', 'excel', 'xlsx', 'spreadsheet', 'download', 'bookkeeping format'],
    body: `The app exports daily logs as a styled Excel file in the bookkeeper's format (No., Mail Subject, dates, facility, stylist, client, room, services, amount, notes, tips, payment type).

From the Daily Log: the Export button exports the current facility for a date range.
From Analytics: the Export button lets you pick MULTIPLE facilities (or "all") plus the date range — bookkeepers and the master admin see every facility in the list.

Only completed visits export. "Invoice" in the Payment Type column means the visit is on the open balance; Cash/Check/Card/ACH mean paid directly. On phones and the native app the file opens in the share sheet; on desktop it downloads.`,
  },
  {
    id: 'master-admin',
    title: 'Master Admin — running the whole network',
    keywords: ['master', 'network', 'all facilities', 'facility list', 'health', 'franchise', 'merge facilities', 'debug', 'impersonate', 'directory', 'applicants'],
    roles: ['master'],
    body: `The Master Admin page is the owner's command center:

- Facilities: every community with monthly appointment counts, collected totals, outstanding balances, and a health score chip (green/amber/red from utilization, collections, and cancellations). Search, sort, create, edit, deactivate.
- Reports: network-wide monthly and outstanding reports, plus the Ask AI card with full network scope.
- Franchises: group facilities under franchise owners.
- Merge: fold duplicate facility records together (guided, with a type-the-name confirmation).
- Imports: the hub for QuickBooks CSVs, service-log history, price sheets, and the facility CSV.
- Stylist Directory: every stylist across the network, with the applicant pipeline and ZIP-radius search.
- Feedback: read and REPLY to in-app feedback from any user (they get a notification and email; you can also do this by voice — "any new feedback? reply that it's fixed").
- Debug: preview the app exactly as a facility admin, front desk, bookkeeper, or a specific real stylist — and open a demo family portal.

You can switch the app to any facility (sidebar switcher, or tell the assistant "switch me to Glen Meadow") and then use every normal page — calendar, log, residents, billing — as that facility. The assistant can also act on ANY facility without switching: just name it ("book Mrs. Smith at Symphony Manor…", "how much does F228 owe?").`,
  },
  {
    id: 'signage',
    title: 'Signage — printable salon signs',
    keywords: ['sign', 'poster', 'print', 'salon day', 'holiday', 'closed', 'welcome'],
    roles: ['admin', 'facility_staff', 'master'],
    body: `The Signage page (sidebar, desktop) makes ready-to-print salon signs: Salon Day, Now Open, Price List, Welcome, and holiday variants (Holiday Hours, Closed, Happy Holidays).

Pick a template, edit the text, watch the live preview, then "Print / Save PDF" — it opens the sign in a print window; use your browser's Save-as-PDF to keep a file. Signs are automatically branded with the facility name.`,
  },
  {
    id: 'notifications',
    title: 'Notifications — bell, push, digests, reminders',
    keywords: ['notification', 'bell', 'push', 'alert', 'digest', 'reminder', 'email summary'],
    body: `Where the app tells you things:

- The bell (top bar / mobile header) is your in-app inbox: new booking requests, schedule changes, coverage requests and decisions, waitlist matches, birthdays, payment failures, feedback replies.
- Push notifications: opt in from My Account (works in the installed app and most browsers). Stylists get a nightly "Tomorrow: N appointments, first at…" reminder when opted in.
- Daily digest: an opt-in morning email per facility (Settings → Notifications) summarizing the day ahead, including upcoming resident birthdays.
- Weekly owner digest: the master admin gets a Monday summary of the whole network.
- Monthly facility report: opt-in per facility — emails the facility their statement on the 1st.
- Family reminders: appointment-reminder texts to POA phones (where texting is enabled).`,
  },
  {
    id: 'offline',
    title: 'Working offline',
    keywords: ['offline', 'no internet', 'no signal', 'connection', 'sync', 'saved copy'],
    body: `The app keeps working when the connection drops — common inside senior living buildings.

- Pages you've visited stay available; the daily log and calendar show the last saved copy with an "Offline — showing saved copy" pill.
- Most day-to-day actions QUEUE while offline: marking visits done/paid, edits, walk-ins, check-in, sign-up requests, photos. You'll see "Saved on this device" — everything syncs automatically when the signal returns, and the banner shows how many changes are waiting.
- Payments are never taken or queued offline, by design.
- If you open the app with no connection at all, the offline hub shows today's cached schedule and the resident roster.

Nothing to configure — just keep working and let it sync.`,
  },
  {
    id: 'tutorials-help',
    title: 'Help Center — guided tutorials',
    keywords: ['tutorial', 'tour', 'learn', 'training', 'onboarding', 'how to use', 'walkthrough', 'demo'],
    body: `The Help Center (Help in the sidebar / More menu) has interactive guided tours for every role — they spotlight real buttons and walk you through clicking them, using safe practice data that never touches your real records (a "Tutorial Mode" banner shows while practicing, and practice data cleans itself up).

Completed tours get a ✓ badge, and new users see a getting-started checklist on the dashboard that checks off as they learn. You can re-run any tour anytime. If a tutorial ever seems stuck, closing it (the ✕) always returns the app to normal.

And of course — you can just ask me. I can explain any feature in as much detail as you want, walk you through the steps, or in many cases do the thing for you (with a confirm tap).`,
  },
  {
    id: 'assistant',
    title: 'The AI assistant — what it can do',
    keywords: ['ai', 'assistant', 'voice', 'ask', 'sparkle', 'chat', 'what can you do'],
    body: `The assistant (the sparkle button, and the Ask AI card on Analytics) answers questions from your real data and makes changes for you — always with a Confirm tap before anything is saved.

Ask things: "who's on the schedule tomorrow?", "how much does Mrs. Hall owe?", "when was John's last visit?", "how did we do last month?", "how do I scan a log sheet?"

Do things (role-permitting): book, move, or cancel appointments ("put her in my next open slot"), mark visits done/paid with tips, add walk-ins and brand-new residents, update rooms and family contacts, set a stylist's weekly hours, file or approve time off, manage the waitlist and sign-up sheet, create or reprice services, send a receipt to the family. The master admin can do all of this for ANY facility by naming it, ask network-wide money questions, reply to feedback, and say "switch me to [facility]".

Data answers come with visual cards — mini tables and tiles under the reply (today's schedule, who owes the most, who's due for a visit). Tap any person's name on a card to pop open their quick profile.

It speaks plain English (typos fine), understands relative times in your facility's timezone, and if a name is close-but-not-quite it asks "did you mean…?". Voice: tap the mic, or use your keyboard's mic key in the app.

It can never do more than your role allows, and it never touches payments, refunds, or bulk sends.`,
  },
]

/** Trivial word-overlap scorer — the tool layer normalizes via fuzzy.ts. */
export function scoreGuide(guide: HelpGuide, words: string[]): number {
  if (words.length === 0) return 0
  const hay = `${guide.title.toLowerCase()} ${guide.keywords.join(' ')} ${guide.id.replace(/-/g, ' ')}`
  let hits = 0
  for (const w of words) {
    if (w.length < 3) continue
    if (hay.includes(w)) hits++
  }
  return hits
}
