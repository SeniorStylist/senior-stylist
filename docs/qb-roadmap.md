# QuickBooks integration — roadmap (researched 2026-09-02)

Josh asked for "the best merge and function we can make" between the site's
workflow and QuickBooks. This is the ranked plan, built from a comparison of
ten salon/service platforms (Boulevard, Phorest, Zenoti, Vagaro, Fresha,
Mangomint, GlossGenius, Meevo, Square, Mindbody/Bookkeep), the Stripe→QBO
connectors bookkeepers actually use (Synder, Acodei, Webgility, Amaka, Intuit's
own Stripe app), Intuit's engineering rules (token rotation, rate limits,
requestid, CDC/webhooks, void semantics), and senior-care billing practice
(RFMS resident trust checks, PNA rules, per-resident authorization).

## What is already right (do not re-litigate)

- **Invoice + Payment (A/R) model with real sub-customers under an F-code
  parent** is the converged pattern for a bill-after-the-fact business. The
  daily-summary journal-entry tools (Boulevard, Phorest, Amaka) are for walk-in
  POS with no receivables. Never add a summary-JE mode.
- **One token per QuickBooks company, refresh serialized by a DB lease** (P59),
  **requestid on every money-bearing create** (P59), **deterministic
  `SS-<ref>` payment refs with find-before-create** (P58), **site-paid clamp so
  a pull can never re-open a paid invoice** (P58), **per-run undo ledger**
  (P58), **shared-realm guard on every pull** (P57).
- **Refuse-to-guess posture**: ambiguous site-vs-QB rows are surfaced, never
  auto-resolved. Every new mirror type below must keep that posture.

## Tier 1 — build next (low risk, no owner decision needed)

1. **Stripe payout deposits + fee expense.** Today every mirrored card payment
   lands in Undeposited Funds and Stripe fees are never booked, so Lisa's bank
   feed shows a net payout that matches nothing (the #1 complaint on every
   Square/Vagaro/Stripe connector thread). Add the `payout.paid` Stripe
   webhook → list the payout's balance transactions → ONE QB Deposit per payout
   (one line per mirrored Payment via `LinkedTxn`, one negative line to a
   "Stripe Processing Fees" expense, `DepositToAccountRef` = the operating bank
   account, `PrivateNote` = payout id). Persist the fee + balance-transaction
   id on `qb_payments` at charge time. Record the deposit in `qb_sync_runs` so
   Undo can delete it. A payout whose lines don't sum to Stripe's net is
   **parked as needs_review**, never posted.
2. **Account-mapping card** in Settings → Billing → QuickBooks (manage tier +
   master), backed by `qb_sync_state`: Salon Services item, deposit-to account
   (Undeposited Funds default / Stripe Clearing), Stripe fees expense, Tips
   Payable, payment methods (Card/Check/Cash/ACH), commission expense (the
   existing expense account). Each is a dropdown from the existing
   `/api/quickbooks/accounts` with "create it for me" defaults. Today those
   choices are invisible auto-provisioning Lisa can't see or change.
3. **Tips → Tips Payable liability, not the commission expense account.**
   `sync-bill` books the "… tips" Bill line to the same expense account as
   commission, which double-counts economically and inflates 1099-NEC box 1.
   Map the tips line to an Other Current Liability account (from the mapping
   card). Also set `Vendor1099 = true` on stylist vendors.
4. **Mirror scanned checks and cash as QB Payments** through the existing
   mirror queue (`kind: 'check'`): one Payment per resident sub-customer
   (`PaymentRefNum` = check number, method = Check) + ONE Deposit for the
   physical check; facility-level (RFMS remittance) checks become one Payment
   on the parent. Removes Lisa's double keying and the pool-and-pop dance.
   Keeps the `residentLinesSum === amountCents` invariant as the gate.
5. **Customer Type ("Private Pay" / "Facility Billed")** on every parent and
   sub-customer from `facilities.payment_type` + `residents.resident_payment_type`.
   Zero UI; QB's A/R aging and Sales by Customer Type split by payer for free.
6. **Refund semantics by payout state.** Today a refund voids the mirrored
   Payment. Correct before the payout lands; wrong after (the void re-opens the
   invoice while the refund is a separate negative in a LATER payout, so two
   payouts stop matching). After payout: leave the Payment, post a Refund
   Receipt keyed by the Stripe refund id. Surface "already deposited — void in
   QB manually" when a Deposit references the payment instead of retrying.
7. **Disconnect-URL receiver** (`GET /api/quickbooks/disconnected?realmId=`,
   public). It is an unauthenticated browser redirect, so it must NOT wipe
   tokens: probe CompanyInfo, and only on a confirmed `invalid_grant` mark the
   realm reconnect-needed + notify the owner. Register the URL in the Intuit
   app (checklist G.1).
8. **Vendor/Employee name pre-check before creating a customer** — DisplayName
   is unique across customers, vendors and employees. A resident who shares a
   stylist's name currently hits 6240 and gets a suffix; check Vendor first and
   prefer re-activating an inactive exact match over suffixing.
9. **5010 stale-object retry helper** — one shared `qbUpdateWithSyncToken`
   that re-GETs and retries once on a stale SyncToken (voids, deactivations,
   sparse updates).

## Tier 2 — owner decisions (ask Josh / Lisa before building)

- **Prepay, gift and banked credits in QB.** Today they are site-only
  `qb_unapplied_credits`. Mirroring each as a QB Payment with no invoice lines
  (= customer credit / UnappliedAmt) and each site credit application as a $0
  Payment makes the payout deposit balance and puts the liability on the
  books. Decision: does Lisa want customer credits living in QB, or keep the
  site as the credit ledger?
- **Per-resident invoices with `BillWithParent` for facility-billed
  residents.** Facility-mode push currently makes one invoice on the parent
  with residents as line text, which throws away per-resident A/R in QB — the
  thing RFMS remittance slips and the check scanner are keyed on. Switching to
  one invoice per sub-customer with BillWithParent keeps the facility rollup
  and gives QB the resident ledger. Decision: Lisa's preference for how the
  facility statement should read in QB.
- **Location (Department) per facility.** Revenue and A/R already fall out of
  the parent-customer hierarchy, but EXPENSES (commission Bills, fees,
  rev-share) don't. Opt-in only: if the realm has Location tracking on, set
  `DepartmentRef` on invoices, payments, deposits and Bills (Class per Bill
  line when a pay period spans facilities). Decision: does Lisa want P&L by
  facility in QB?
- **Revenue share as its own expense.** `calculateRevShare` computes the split
  but nothing reaches QB. `we_deduct` → monthly Bill to the facility-as-vendor;
  `facility_deducts` → auto-proposed Credit Memo when a check equals invoice ×
  (1 − pct). Decision: how the boss wants rev-share to show on the P&L.
- **Cash-application tolerance** ($5 / 1% default) that books a tiny write-off
  credit memo instead of blocking a short check. Decision: the tolerance
  amount, if any.
- **BillPayment recording** when a pay period is marked paid on the site (or
  leave paying Bills to Lisa in QB). Decision: who pays stylists where.

## Tier 3 — later

- QuickBooks **webhooks + Change Data Capture** so a check Lisa keys into QB
  reaches the site (and the autopay sweep + site-paid clamp) within minutes
  instead of at 05:00 UTC. Same sync functions, just woken earlier; the cron
  stays as the backfill.
- **QB digest** in the weekly owner email: invoices pushed, payments mirrored,
  payouts deposited, rows parked, runs undo-able.
- **Nightly AgedReceivables pull** → "QB says $X / site says $Y" on the master
  QB page and the billing aging strip.
- **Dispute handling** (`charge.dispute.*`): pause autopay for the resident,
  notify, book the loss only on `closed/lost`.
- **Facility charge file** (per-visit itemized resident charge sheet, CSV/XLSX
  import-ready for PCC/ECP) so business offices post withdrawals faster and
  RFMS checks arrive sooner.
- **"What syncs / what doesn't" matrix** on the Settings QuickBooks card so
  Lisa knows which entries she still owns.

## Audit outcome (2026-09-02)

The workflow's research agents completed; its five adversarial audit finders
did not (session limit), so the bug/security pass was done by hand over the
full branch diff. Found and fixed on the branch:

- Realm-level pull picked the "oldest" cursor by string sort — mixed cursor
  formats (`…Z` vs QB `…-07:00`) could pick a NEWER cursor and skip a
  facility's rows. Now by `Date.parse`.
- Refresh lease was held for its full 45s when a worker won it but found the
  token already fresh. Now released immediately.
- `qbFetch` error bodies were unbounded and several routes echo them to the
  operator. Capped at 600 chars.
- `/api/facility` GET/PUT still derived `hasQuickBooks` from the nulled legacy
  token columns — the Settings QuickBooks card would have flipped to "not
  connected" after any settings save. Now uses `isFacilityConnected()`.
- Billing summary still selected the legacy token columns. Removed.
- Master could not anchor a `scope=franchise` connect (no membership row).
  Now accepts `facilityId` for master on any scope.

Reviewed and found sound: OAuth `state` (nonce consumed before exchange, scope
re-validated against the real role in the callback, fixed landing paths — no
open redirect), attach/detach/disconnect role gates, realm-level token storage
(tokens never selected into client payloads), payment-mirror claim + adopt +
live-balance cap, cron cooldown/notification batching, QBO query escaping.
