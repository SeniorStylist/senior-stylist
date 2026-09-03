# Fitzgerald Walkthrough — click-through of every scenario

**Who this is for:** Josh, Lisa and Dad, sitting together before The Fitzgerald
of Palisades goes live. It is the thing Lisa asked for after the 2026-08-18
meeting: not a description of how the app works, but a script you tap through,
in order, where every step says what to do and what you should see.

**Before you start**

- Finish `docs/new-facility-runbook.md` sections 1 and 2 (platform env and
  migrations). This walkthrough assumes they are done.
- Do the whole thing on a **practice facility first**, not on the real
  Fitzgerald record. Master Admin → Debug → pick a facility → **Launch
  rehearsal** creates the practice pieces (a demo resident, a demo stylist with
  Monday–Friday hours, a practice price list, today's booking) and opens
  scenario 2 for you. Practice records are marked internally and never mix into
  real reports.
- Have a phone in your hand for the family scenarios. Several of them only look
  right on a phone, and that is how families will use it.

**Test cards** (only work while Stripe is in test mode)

| Number | What it does |
|---|---|
| 4242 4242 4242 4242 | Succeeds |
| 4000 0000 0000 0002 | Declines — use it to see the failure message |
| 4000 0025 0000 3155 | Asks for the bank's extra verification step |

Any future expiry date, any 3-digit code, any ZIP.

---

## 1. Create the facility

**Do:** Master Admin → **+ Create Facility**.

1. **Facility** — type the community name. The facility code fills itself in
   with the next free number; you can type a different one. If the name or the
   code is already taken you are told before you can continue, and the message
   names the facility that has it.
2. **Hours** — pick the salon days and the open/close times.
3. Tap **Create facility**. From here the facility exists; the first two
   screens turn into a summary you can no longer edit.
4. **Stylists** — search a stylist by name or code and tap to add them, or
   create a new one, or upload the stylist sheet. Each stylist you add carries
   the salon days as their working days; adjust the day chips per person.
5. **Services** — upload the community's price sheet (PDF, photo, Word, Excel
   or CSV). The scanner reads it, you review the list, then add them.
6. **Billing** — who pays, revenue share, and when saved cards are charged.
   Choose **automatically, when a visit is completed** for Fitzgerald.
7. **Done** — a checklist. Everything green means the facility is ready.

**You should see:** every checklist row green, the facility code shown at the
top, and two buttons: **Print QR poster** and **Enter facility**.

**Verify:** tap **Print QR poster**. The poster carries the community name and
a QR code. Scan it with your phone camera — it must open
`portal.seniorstylist.com`, not a preview address. Then tap **Enter facility**:
the facility name in the top-left corner and the page you land on must both be
the new facility. That corner disagreeing with the page was the bug from the
meeting; it is fixed, and this is where you confirm it.

**Bulk alternative:** if you are onboarding many communities at once, Master
Admin → Imports → **Facility Sheet Import** takes the spreadsheet export. New
codes are created; existing ones are refreshed. The wizard's first screen links
to it.

---

## 2. A family creates their account from the QR poster

**Do:** on your phone, scan the poster (or open
`portal.seniorstylist.com/family/<CODE>/signup`).

1. Say you are a family member, and give your name.
2. Type the resident's name and room number.
3. If the app recognises the resident it asks "is this them?" — say yes.
4. Give an email address, a phone number, or both. At least one is required.
   The phone number is required for texts, and the consent line under it is
   what the phone carriers check — do not remove it.
5. Choose a password.
6. Review, then continue to the payment step and add a card.

**You should see:** one question per screen, large type, and a back arrow that
works — both the app's Back button and the phone's own back gesture. Reload the
page mid-way: your answers are still there. The password never is, by design.

**Verify:** finish the signup and check the email inbox for the sign-in link.
Then repeat the whole thing with **only a phone number** and no email — that
family gets a text instead. (Texts stay silent until Twilio is switched on;
see the runbook.)

**Practice mode:** the Debug tab's **Family Sign-Up Wizard (dry run)** runs this
same flow end to end and creates nothing at all — no account, no resident, no
email. Use it to show the flow without leaving records behind.

---

## 3. The family requests a visit

**Do:** in the family account, tap **Request a visit**. Pick a service, pick a
day, add a note, submit.

**You should see:** the days the salon is closed are not selectable. No prices
are shown to the family here — pricing is a conversation with the office. After
submitting, an acknowledgement arrives by email, by text, or both, depending on
what the family gave you.

**Verify:** the request must arrive in the app. Sign in as the stylist and open
the Calendar — the request is in the pending panel with a badge on the tab. If
your facility has more than one stylist and nobody has hours set yet, the
request stays **unassigned**, which means every stylist sees it. That is
deliberate: a request must never be parked on one stylist's queue where nobody
else can find it.

---

## 4. The stylist takes the request and picks a time

**Do:** as the stylist, open the pending request and tap **Pick time →**.
Choose the slot, save.

**You should see:** the request becomes a real appointment on the calendar, and
the family gets a confirmation naming the stylist, the day and the time — by
email and by text, matching how they signed up.

**Verify:** back in the family account, the appointment appears under upcoming
visits with the right day and time.

**Note on who schedules:** facility staff and facility admins deliberately
cannot place a time slot. They add requests to the sign-up sheet; the stylist
converts them. If a facility admin tries, the app opens the sign-up sheet
instead of a booking form. This is the P53 rule and it is intentional.

---

## 5. The stylist's own login

**Do:** sign in as the stylist on their phone.

**You should see:** their calendar and their day log, showing only their own
work. If the login is not yet connected to their stylist record, they see an
amber banner explaining it and a button to ask an admin to link them — never a
blank screen.

**Verify:** if you see that banner, go to Settings → Team as an admin, find the
person and use **Assign stylist**. Then reload their session. This is also how
you fix a stylist who changed email addresses: disconnect, invite the new
address, relink.

---

## 6. The day itself

**Do:** as the stylist, open the Day Log.

1. Mark a visit **Done**.
2. Add a **walk-in** for someone not on the list — including a brand-new
   resident, typing their name, room, and the family's email or phone.
3. If a family wants a card kept on file, use **Save a card on file** on their
   row and enter the card on your phone. Tick the box that records that the
   family asked for automatic payment.

**You should see:** rows with a card on file carry a readable **Card** tag, and
rows covered by salon credit carry a **Credit** tag — not a tiny symbol you
have to hover over.

**Verify:** the new walk-in resident's family receives a "finish setting up your
account" link, whether the walk-in was added by the stylist or by an admin.
When you saved the card with the box ticked, the family receives a notice that
automatic payment was switched on — that notice is the safety net, so it should
always arrive.

---

## 7. Finalize the day and charge

**Do:** at the end of the day, tap **Finalize** on the day log.

**You should see:** every completed visit for a resident with a saved card and
automatic payment on is charged once, and each family gets a receipt.

**Verify (the important one):** tap **Finalize** a second time. Nothing is
charged again. Check Stripe: exactly one payment per visit. Then check that the
receipt reached the family by email **and** by text where you have both.

If a card declines, the family gets a payment link instead and the facility's
admins get a notification. Use the declining test card once, on purpose, so you
have seen what that looks like before it happens for real.

---

## 8. What the family sees afterwards

**Do:** open the family account again.

**You should see:**

- **Appointments** — past visits with what each one cost, and the tip shown
  separately when there was one.
- **Salon Account** — the balance, payment history, and the option to add funds.
- **Automatic payment** — a switch the family controls themselves. Turning it
  on or off sends them a confirmation.
- **Share a gift link** — a link a relative can open to put money on the
  resident's account without needing an account of their own.

**Verify:** open the gift link in a private browser window. It shows the
resident's first name and an initial only, never the full name and never any
balance.

---

## 9. Before you hand over the real facility

Work down this list on the real Fitzgerald record, not the practice one:

- [ ] Facility created with its F-code, hours set, billing set to charge when a
      visit is completed.
- [ ] Services loaded from the real price sheet.
- [ ] Tatyana added, her login linked in Settings → Team, and her weekly hours
      entered.
- [ ] QR poster printed and hung where families will see it.
- [ ] One real family signed up in front of you and their card saved.
- [ ] One real visit completed, charged, and its receipt confirmed received.
- [ ] Facility admin and front-desk logins invited, and they know that
      scheduling goes through the sign-up sheet.

When every box is ticked, the community is live.

---

## If something looks wrong

| What you see | What it means |
|---|---|
| Top-left facility name disagrees with the page | Report it — this was fixed in P60 and must not come back. |
| A stylist you added is nowhere | They were created without a facility. Open Stylists → add them again by code; the app tells you they already exist and attaches them. |
| Family sign-up says it is unavailable | Self-signup is off for that facility. Master Admin → Facilities → **Turn on everywhere**, or the per-facility switch in Settings → Family Accounts. |
| Cards save but nothing is ever charged | Billing is on **manually**. Settings → Billing shows an amber notice when this is the case; switch to charge when a visit is completed. |
| Family gets no email | Check the address on the resident, then check that the sender domain is verified. Nothing about the app changes this. |
| Family gets no text | Twilio is not switched on yet. Runbook section 1. |
