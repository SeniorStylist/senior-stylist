export interface ChangelogEntry {
  version: string
  date: string // ISO YYYY-MM-DD
  title: string
  items: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '5.5',
    date: '2026-07-23',
    title: 'Watch It Work — A Smarter, Friendlier Assistant',
    items: [
      'No more frozen "Thinking…" — the assistant now narrates as it works: "Checking the schedule…", "Crunching the numbers…", "Building your walkthrough…" swap live while it runs',
      'It never forgets your chat: the conversation survives page reloads and facility switches, and there\'s now a Stop button plus one-tap Retry when something fails',
      'The suggestion chips adapt to where you are — on the Daily Log you\'ll see "Help me scan a sheet", on Billing "Who owes the most?" — and they stay visible while you chat',
      'New "☀️ My morning brief" chip: today\'s schedule, anything unpaid, and who\'s due for a visit in one tight summary',
      'Ask "who\'s due for a visit?" or "who has open time today?" — the assistant now finds residents overdue by their own visit rhythm and open gaps in stylists\' days, and offers to book them together',
      'Rate any answer 👍/👎 — feedback goes straight to the owner so the assistant keeps getting better; and a new "Meet your AI assistant" tour lives in the Help Center',
      'Cancelled the wrong appointment through the AI? The success toast now has one-tap Undo',
    ],
  },
  {
    version: '5.4',
    date: '2026-07-23',
    title: 'Your AI Coworker — It Walks You There',
    items: [
      'Ask "help me scan this sheet" or "take me to settings" and the assistant doesn\'t just explain — the chat shrinks to a small pulsing bubble, the app moves to the right page, and a spotlight + arrow lands on the exact button, step by step',
      'It fills fields for you as you go (you watch it type), and YOU perform every tap on the highlighted element — nothing happens without your finger on it, all on your real data',
      'Tap the pulsing bubble anytime to reopen the chat mid-walk — your whole conversation is still there; close the walk with the ✕ whenever you\'re done',
      'Works for every role, everywhere: scanning sheets, adding walk-ins and residents, booking, inviting teammates, sending statements, and more',
    ],
  },
  {
    version: '5.3',
    date: '2026-07-23',
    title: 'Your Assistant Remembers You',
    items: [
      'The AI now has a memory: tell it "remember I like money shown by month" or "call me Jo" and it saves that for you — permanently, across every chat. Say "forget that" any time, or ask "what do you remember about me?"',
      'Owner superpower: the master admin can say "remember for all stylists: …" or "remember for this facility: …" and every matching person\'s assistant follows that instruction immediately',
      'The AI also proposes its own learnings ("stylists often want their services logged for them") — these land on the Master Admin feedback page where the owner reviews each one, edits it, picks who it applies to (everyone, one facility, or one role), and approves or rejects it. Nothing spreads without approval.',
      'Role security tightened: anyone claiming permissions they don\'t have gets a firm, polite refusal — while the assistant stays fully capable within their real role. Only the owner account has network-wide access.',
    ],
  },
  {
    version: '5.2',
    date: '2026-07-23',
    title: 'The AI Knows Exactly Who You Are',
    items: [
      'Fixed the big one: if the owner account also belonged to a facility as an admin, the AI quietly treated you as just that facility\'s admin — "only a Master Admin can see network data" while you ARE the master admin. The owner is now ALWAYS the owner, network-wide, no matter what.',
      'The assistant now knows your name and exact role on every message — ask "who am I?" and it answers correctly, and it will never argue with you about your own permissions again',
      'If you\'re previewing the app as another role through Debug Mode, the AI knows that too and says so instead of acting confused',
    ],
  },
  {
    version: '5.1',
    date: '2026-07-23',
    title: 'Quick/Smart Switch + The AI Makes Things',
    items: [
      'New Quick | ✦ Smart switch right in the AI chat: Quick is fast and economical (the default), Smart thinks deeper for hard questions — your pick is remembered on your device',
      'Quick mode got a brain transplant: the assistant now always knows every role and what each person can do, every page of the app, and the money rules — so "what can a bookkeeper do?" or "where do I print the week?" answer instantly',
      'Ask it to MAKE things: "make me a closed-for-holiday sign for Friday" gives you a tap-to-open link with the sign ready to print; "create an invoice for Mrs. Hall" opens her printable statement built from real billing data',
      'Money answers now show the math — the period, the total, and what it breaks into',
      'Billing documents are always generated from QuickBooks-synced data — the AI never invents billing records and never sends anything without you',
    ],
  },
  {
    version: '5.0',
    date: '2026-07-22',
    title: 'The Assistant Sees Everything (Owner Edition)',
    items: [
      'Master admin: the assistant now covers your WHOLE network — "which facility owes us the most?" answers across every community, and you can act on any facility just by naming it: "book Mrs. Smith at Symphony Manor tomorrow at 10", "how much does F228 owe?"',
      'Say "switch me to Glen Meadow" and the app moves there — the facility switcher also now works properly for the owner account everywhere',
      'Real answers to "how do I…": the assistant has a built-in guide to every feature — ask how to scan a log sheet, set up the family portal, or run payroll and it walks you through step by step, with as much detail as you want',
      'Upgraded to a smarter AI model across the board — better at understanding shorthand, misspellings, and what you actually meant',
      'Every cross-facility change shows which community it lands in on the confirm card, and nothing ever saves without your tap',
    ],
  },
  {
    version: '4.9',
    date: '2026-07-22',
    title: 'Ask the AI to Do It',
    items: [
      'One AI everywhere: the Ask AI panel on Analytics and Master Admin is now the SAME full assistant as the sparkle button — it answers questions AND makes changes, with a confirm tap before anything is saved',
      '"Who owes us the most?" now names real residents with live balances, and "how much does Mrs. Hall owe?" pulls her full ledger — invoices, payments, and credits',
      'Tell it what to change: mark visits paid or no-show, add a tip, set a stylist\'s weekly hours, file or approve time off, add someone to the waitlist or sign-up sheet, create or reprice a service, update a room number or POA contact, send a receipt to the family',
      'Every role gets exactly their own powers — stylists manage their own day, front desk handles scheduling and residents, bookkeepers fix billing fields, the master admin can also read and reply to feedback by voice',
      'It understands messy asks: misspelled names get a "did you mean…?", brand-new residents are offered as a create, and relative times ("tomorrow at 10") resolve in your facility\'s timezone',
    ],
  },
  {
    version: '4.8',
    date: '2026-07-22',
    title: 'Supervisor Tools + Smarter Assistant + Mobile Polish',
    items: [
      "Admins, franchise admins, and the master admin can now set any stylist's weekly hours and file time off for them, right on the stylist's page (time off filed by a supervisor is pre-approved)",
      'The master admin can now do everything on stylist pages without impersonating: edit schedules, approve time off, verify compliance docs, send account invites',
      'Assistant upgrade: say "put Mrs. Smith in my next available slot" — it reads the real schedule, offers open times, and books the one you pick (always with a confirm tap)',
      'Big mobile fix: dialogs no longer get shoved off-screen when the keyboard opens (the cut-off New Pay Period bug), tall dialogs scroll instead of clipping, last rows never hide behind bars, and the scroll indicator finally lines up',
      'The getting-started checklist no longer covers the assistant and feedback buttons on phones',
    ],
  },
  {
    version: '4.7',
    date: '2026-07-21',
    title: 'Your AI Assistant + Pick Any Stylist',
    items: [
      'New AI assistant on every page (the sparkle button, bottom-right): ask about your schedule, residents, or numbers — or tell it to book, move, or cancel an appointment. It always asks you to confirm before anything changes. Type or talk.',
      'Booking dialog: you can now pick the stylist yourself — auto-assign stays the default, but "no stylist available" never blocks you again',
      'Fixed dialogs getting cut off behind the bottom bar on phones (Log Sheet History, Duplicates, and friends)',
      '"Who owes us the most?" now works for the master admin with a facility selected',
    ],
  },
  {
    version: '4.6',
    date: '2026-07-21',
    title: 'Stylists Unblocked & Feedback Replies',
    items: [
      'Stylists can now photograph and scan their own log sheet from the Daily Log — every imported visit lands under their own name automatically',
      'Walk-ins fixed for stylists: adding a brand-new resident works again, and a new "➕ New service" option lets you add a missing service with its price right in the form',
      'Feedback is now a two-way street: the team can reply to your notes, you get a notification (and email), and replies live on the new My Feedback page',
    ],
  },
  {
    version: '4.5',
    date: '2026-07-15',
    title: 'Family Portal, Upgraded',
    items: [
      'Print a QR sign-up poster for your facility — families scan it and land on YOUR facility\'s sign-up, no choosing, no confusion',
      'New Portal Status panel: see who\'s connected, who can be invited, and invite every family with one tap',
      'Families can now add care preferences: style notes, allergies (shown to the stylist on the daily log), a preferred stylist, visit rhythm, and reminder choices',
      'Merging duplicate residents now carries EVERYTHING to the kept resident — portal access, saved cards, billing history, photos — and the merge screen shows POA/Portal/Card badges with clear warnings first',
      'Apple Pay and Google Pay at the chair (after a one-time Stripe setting), plus "Make main card" on saved cards',
      'Link any family email to a resident directly from their page — existing accounts connect instantly',
    ],
  },
  {
    version: '4.4',
    date: '2026-07-15',
    title: 'Ask AI About Your Business',
    items: [
      'New "Ask AI" panel on Analytics (and Master Admin → Reports): ask plain-English questions like "Which facility owes us the most?" or "What was our best service last month?" and get answers computed from your real numbers',
      'Answers only ever come from your own data — revenue counts completed visits, and every figure says what period it covers',
      'Admins and bookkeepers see their facility; the master admin sees the whole network',
    ],
  },
  {
    version: '4.3',
    date: '2026-07-15',
    title: 'Accurate Earnings',
    items: [
      'Revenue now counts only COMPLETED visits — scheduled or cancelled appointments no longer inflate Analytics, dashboard tiles, totals, or exports',
      'Days now roll over on your facility\'s clock: an 8pm appointment shows on the right day in the daily log and analytics, and the log no longer flips to tomorrow at 8pm Eastern',
      'Cancelling an appointment now removes it from Google Calendar and warns you when it was already marked paid',
      'Cancels and deletes made on spotty wifi sync automatically when you\'re back online',
    ],
  },
  {
    version: '4.2',
    date: '2026-07-14',
    title: 'Snappier Everywhere',
    items: [
      'Pages start loading the moment you tap — the offline system no longer sits in front of the network on every navigation',
      'Offline saving now happens quietly in the background and skips work when nothing changed — no more stutter while flipping calendar days or log dates',
      'The server does about half the work per page: your facility list and each resident\'s usual service are now remembered between pages',
      'Tutorial code no longer loads on every page — only when you actually run a tutorial',
      'Nothing about offline mode changed — same saved pages, same syncing, same privacy',
    ],
  },
  {
    version: '4.1',
    date: '2026-07-14',
    title: 'Stylist Privacy & Day-Log Fixes',
    items: [
      'Stylists now see only their own appointments and daily log — walk-ins are locked to the signed-in stylist everywhere, including on the server',
      'Fixed the mobile daily log: Done / No-show always respond (and tell you why if something fails), and the cramped service/price row is redesigned',
      'Delete an appointment by swiping its row or from the Edit form — with a confirm step',
      'Settings → Team: the Assign-stylist list now scrolls properly, and "Disconnect stylist" lets you unlink a login when someone switches emails',
      'Master admin can preview as a specific real stylist from the Debug tab — the preview now behaves exactly like that stylist\'s account',
    ],
  },
  {
    version: '4.0',
    date: '2026-07-12',
    title: 'Works Offline Everywhere',
    items: [
      'Nearly everything you do during a workday now saves offline and syncs later — sign-up sheets, waitlist, bookings from the calendar, day reschedules, and time-off requests join the existing walk-ins, edits, and photos',
      'The offline screen is now a real hub: today\'s schedule, your saved week, and a searchable resident roster',
      'Family members get their own offline card — next appointment and the facility phone number, in English or Spanish',
      'Offline storage grew from 1.5MB to 25MB and keeps a full week of saved copies',
      'The iPhone/iPad app opens to a branded retry screen instead of a browser error when launched with no signal',
    ],
  },
  {
    version: '3.9',
    date: '2026-07-12',
    title: 'Smoother & Smarter',
    items: [
      'Fixed the Master Admin page error — the access-request approval queue works again',
      'Master Admin facilities list can no longer be blanked by tutorial practice mode (and shows a clear banner + exit button when practice data is mixed in)',
      'Booking and walk-in forms pre-select each resident\'s usual service; one-tap tip presets',
      'Closing a half-filled booking or sign-up form now asks before discarding your typing',
      'Family portal: a big "Pay" button stays at your thumb when a balance is due, and the request form\'s submit button is always in reach',
      'Getting-started checklist gives you credit for signing up — you never start at 0%',
    ],
  },
  {
    version: '3.8',
    date: '2026-07-09',
    title: 'Faster Everywhere',
    items: [
      'Every page checks your login locally instead of calling out to the auth server — navigation is noticeably snappier',
      'Dashboard loads with one combined data request instead of seven separate ones',
      'Fonts now load from our own servers — no more waiting on Google Fonts',
      'Big screens (reports, booking form, scan review) download only when you open them',
      'Stylists can mark a visit done AND paid right on the home screen, with a one-tap jump to the Daily Log',
    ],
  },
  {
    version: '3.7',
    date: '2026-07-07',
    title: 'Speed',
    items: [
      'Much faster app and site: background page-priming trimmed way down so it never competes with your taps',
      'Bottom tabs always switch — if a page is slow to respond, the app forces it through within seconds',
    ],
  },
  {
    version: '3.6',
    date: '2026-07-07',
    title: 'Bookkeeper Fixes & Self-Healing Updates',
    items: [
      'Fixed "Invalid input" blocking every daily-log edit (date, stylist, service, room, amount, tips)',
      'Switching facilities now actually switches the whole page, not just the label',
      'New facility picker right in the Daily Log header — search by name or F-code',
      'After an app update, open tabs refresh themselves instead of showing a chunk error',
    ],
  },
  {
    version: '3.5',
    date: '2026-07-07',
    title: 'Stability & Tutorial Fixes',
    items: [
      'Fixed the outage: background page-warming no longer overloads the database',
      'Tutorials now exit demo mode instantly — on finish, on cancel, even if you close the tab mid-tour',
      "What's New opens as a proper dialog; fixed clipped toolbars on the dashboard",
      'Tutorials work at any time of day and auto-skip a step that fails to load instead of freezing',
    ],
  },
  {
    version: '3.4',
    date: '2026-07-07',
    title: 'Accessibility & Synced Tabs',
    items: [
      'Big accessibility pass for family members: screen-reader labels, announced errors, Spanish pronunciation, higher-contrast helper text',
      'Dialogs now keep keyboard focus inside and return it when closed',
      'Your customized bottom tabs now follow you across devices',
    ],
  },
  {
    version: '3.3',
    date: '2026-07-07',
    title: 'Full Offline Mode',
    items: [
      'Navigate between your pages while offline — recently visited screens keep working',
      'Photos taken offline upload automatically when wifi returns',
      'Walk-ins for brand-new residents now work offline too',
      'Cached pages are private per login and wiped on sign-out (shared-device safe)',
    ],
  },
  {
    version: '3.2',
    date: '2026-07-07',
    title: 'Mobile Comfort Pass & Offline Mode',
    items: [
      'Customize your bottom tabs — pick your 5 most-used, everything else lives under More',
      'Works offline: your schedule and daily log show the last saved copy, and edits sync when wifi returns',
      'Offline banner shows pending changes and confirms when everything synced',
      'Bigger, easier tap targets across the app; dialogs open as bottom sheets on phones',
      'Fixed overlapping buttons and cramped headers on small screens',
    ],
  },
  {
    version: '3.1',
    date: '2026-07-07',
    title: 'Smart Scheduling, Health Scores & Spanish Portal',
    items: [
      'Family portal is now fully bilingual — EN/ES toggle in the header',
      '"Due for a visit" panel suggests residents based on their own visit rhythm',
      'Copy an entire salon day to a new date; print a weekly schedule',
      'Facility health score on Master Admin; invoice aging strip on Billing',
      'Booking style photos — snap from the daily log, share to the family portal',
      'Stylists see a room-to-room route strip and a monthly earnings forecast',
      'Monthly statement email automation and appointment-reminder texts for families',
      'Prepay packages on the family portal (e.g. 3 × Wash & Set)',
    ],
  },
  {
    version: '3.0',
    date: '2026-07-07',
    title: 'Notifications, Waitlist & Payment Safeguards',
    items: [
      'In-app notification inbox with a bell in the header',
      'Cancellation waitlist — freed slots automatically alert the office',
      'Payment safeguards: auto-charge caps, double-pay protection, refunds, autopay consent emails',
      'Weekly owner digest email and resident birthday reminders',
      'Offline write-queue for spotty facility Wi-Fi; Tap to Pay groundwork',
    ],
  },
  {
    version: '2.9',
    date: '2026-06-22',
    title: 'Log Sheet History & Payment Types',
    items: [
      'Bookkeepers can now view, rename, move, and roll back imported OCR log sheets from the Daily Log page',
      'Payment type now supports free-text (Cash, Check, Card, ACH, or custom) on all booking edits',
      'Bookkeeper log editing expanded: tips, payment method, date, resident, service, and delete',
    ],
  },
  {
    version: '2.8',
    date: '2026-06-17',
    title: 'OCR & Price Sheet Improvements',
    items: [
      'Bulk price sheet scanner now auto-detects facility from document content',
      'OCR review shows a proper dropdown for stylist selection (was invisible on most browsers)',
      'Fixed blank imports caused by empty service names in partial rows',
      'Send confirmation dialog before one-click emails and texts',
    ],
  },
  {
    version: '2.7',
    date: '2026-06-15',
    title: 'Family Portal Self-Signup & Authorization Hardening',
    items: [
      'Families can now request portal access directly from the facility login page',
      'Admins review and approve claim requests in Settings → Family Portal',
      'Welcome coupons automatically issued on first portal access',
      'Full authorization audit — closed cross-facility data leaks',
    ],
  },
  {
    version: '2.6',
    date: '2026-06-12',
    title: 'QuickBooks Import Suite & Billing Polish',
    items: [
      'Step 5 unapplied credits importer — import QB Customer Balance Detail CSV',
      'Batch memo scan: match check memo text to residents across all facilities at once',
      'Monthly billing view with by-resident / by-day toggle and CSV export',
      'Check image lightbox and "Match memo" assistant',
    ],
  },
  {
    version: '2.5',
    date: '2026-05-31',
    title: 'Interactive Scripted Tutorials',
    items: [
      'All 30+ help tours are now fully interactive — click through real workflows with demo data',
      'Mobile-specific tour variants for every role',
      'Onboarding checklist widget on the dashboard tracks your progress',
    ],
  },
  {
    version: '2.4',
    date: '2026-05-13',
    title: 'Mobile Layout & Tour Overhaul',
    items: [
      'Fixed iOS Safari layout shell — no more gap under the bottom nav',
      'Tour engine now uses SPA navigation — no page reloads between steps',
      'Stylist check-in with smart day-rescheduling (Phase 12T)',
      'CMD+K command palette for admins (Phase 12V)',
      'Resident and stylist peek drawer (Phase 12W)',
    ],
  },
  {
    version: '2.3',
    date: '2026-05-04',
    title: 'Service Log Import & Reconciliation',
    items: [
      'Import service log XLSX files directly into bookings with fuzzy facility/service matching',
      'Reconciliation queue for bookings that need a service linked',
      'Batch rollback of an entire import with one click',
      'Historical bookings show an "H" badge in the calendar and daily log',
    ],
  },
]

/** ISO date string of the newest entry. */
export const LATEST_CHANGELOG_DATE = CHANGELOG[0]?.date ?? '2020-01-01'
