// P38 — keyless test harness for the AI assistant.
// Run: npx tsx scripts/test-ai-assistant.ts
// No GEMINI_API_KEY and no DB needed: registry filtering + helpers are pure,
// and the Gemini loop runs against a scripted fake transport with fake tools.

import { toolsForCtx, rankByName, parseLocalDateTime, levSimilarity, computeOpenSlots, resolveCtxFacility, ALL_TOOLS, type AssistantCtx, type AssistantTool } from '../src/lib/ai-assistant/tools'
import { HELP_GUIDES, scoreGuide } from '../src/lib/ai-assistant/help-kb'
import { normalizeWords } from '../src/lib/fuzzy'
import { ACTION_RULES, actionAllowed, type AssistantActionKind, type PendingAction } from '../src/lib/ai-assistant/action-allowlist'
import { fromDateTimeLocalInTz } from '../src/lib/time'
import { runAssistant, MODEL_IDS, parseSseChunk, createStreamAssembler, type GeminiTransport } from '../src/lib/ai-assistant/gemini'
import { buildGroundingDigest } from '../src/lib/ai-assistant/grounding'
import { segmentMessage, isAllowedAppLink } from '../src/lib/ai-assistant/app-links'
import { validateWalkSteps, GUIDE_ANCHORS, buildAnchorVocab } from '../src/lib/ai-assistant/guide-anchors'
import { statusLabelFor, hasStatusLabel } from '../src/lib/ai-assistant/status-labels'
import { chipsForPage } from '../src/components/assistant/assistant-chat'
import {
  isAnswerCard, scheduleCard, moneyPackCards, rebookingCard, gapsCard, MAX_CARD_ROWS,
} from '../src/lib/ai-assistant/answer-cards'

let failures = 0
function check(label: string, cond: boolean) {
  if (cond) console.log(`  ✅ ${label}`)
  else {
    failures++
    console.error(`  ❌ ${label}`)
  }
}

const baseCtx: AssistantCtx = {
  userId: 'u1',
  role: 'admin',
  facilityId: 'f1',
  facilityName: 'Sunrise of Bethesda',
  facilityCode: 'F177',
  timezone: 'America/New_York',
  stylistId: null,
  stylistName: null,
  userName: 'Josh Gerhardt',
  debugPreview: false,
  memories: [],
  sharedMemories: [],
}

// ---------------------------------------------------------------------------
console.log('\n[1] Role filtering (toolsForCtx)')
{
  const names = (ctx: AssistantCtx) => toolsForCtx(ctx).map((t) => t.name)

  const admin = names(baseCtx)
  check('admin sees get_business_numbers', admin.includes('get_business_numbers'))
  check('admin sees book/cancel/reschedule', ['book_appointment', 'cancel_appointment', 'reschedule_appointment'].every((n) => admin.includes(n)))
  check('admin does NOT see get_my_earnings', !admin.includes('get_my_earnings'))
  check('admin does NOT see get_facility_numbers', !admin.includes('get_facility_numbers'))

  const stylist = names({ ...baseCtx, role: 'stylist', stylistId: 's1', stylistName: 'Senait Edwards' })
  check('stylist does NOT see billing tools', !stylist.includes('get_business_numbers') && !stylist.includes('get_facility_numbers'))
  check('stylist sees get_my_earnings + schedule + writes', ['get_my_earnings', 'get_schedule', 'book_appointment'].every((n) => stylist.includes(n)))

  const staff = names({ ...baseCtx, role: 'facility_staff' })
  check('facility_staff has no money tools', !staff.includes('get_business_numbers'))
  check('facility_staff can book', staff.includes('book_appointment'))

  const bookkeeper = names({ ...baseCtx, role: 'bookkeeper' })
  check('bookkeeper sees business numbers', bookkeeper.includes('get_business_numbers'))

  const viewer = names({ ...baseCtx, role: 'viewer' })
  check('viewer gets ZERO tools', viewer.length === 0)

  // P41 — a facility-less master keeps the FULL master tool set: the
  // dispatch layer resolves a facility per call from args.facilityName.
  const plainMaster = names({ ...baseCtx, role: 'master', facilityId: null, facilityName: null })
  const facilityMasterNames = names({ ...baseCtx, role: 'master' })
  check('plain master (no facility): FULL master tool set (per-call facility resolution)',
    plainMaster.length === facilityMasterNames.length && facilityMasterNames.every((n) => plainMaster.includes(n)))

  const facilityMaster = names({ ...baseCtx, role: 'master' })
  check('master with facility selected: schedule + writes too', ['get_schedule', 'find_resident', 'book_appointment', 'get_facility_numbers'].every((n) => facilityMaster.includes(n)))

  // ---- P40 write-tool matrix: what each role can and CANNOT do ----
  check('master (facility) sees every P40 write', [
    'update_appointment', 'create_resident', 'update_resident', 'set_stylist_hours',
    'add_time_off', 'decide_time_off', 'add_to_waitlist', 'add_signup_entry',
    'create_service', 'update_service', 'update_stylist', 'reply_to_feedback', 'send_receipt',
  ].every((n) => facilityMaster.includes(n)))

  check('admin write set: all P40 writes except feedback reply', [
    'update_appointment', 'create_resident', 'update_resident', 'set_stylist_hours',
    'add_time_off', 'decide_time_off', 'add_to_waitlist', 'add_signup_entry',
    'create_service', 'update_service', 'update_stylist', 'send_receipt',
  ].every((n) => admin.includes(n)) && !admin.includes('reply_to_feedback') && !admin.includes('get_feedback_inbox'))

  check('stylist writes: own appointments + own hours/time-off + ad-hoc service ONLY',
    ['update_appointment', 'set_stylist_hours', 'add_time_off', 'create_service'].every((n) => stylist.includes(n))
    && ['create_resident', 'update_resident', 'decide_time_off', 'add_to_waitlist', 'add_signup_entry',
        'update_service', 'update_stylist', 'reply_to_feedback', 'send_receipt',
        'get_resident_ledger', 'get_time_off_requests', 'get_waitlist', 'get_payroll_summary', 'get_feedback_inbox',
       ].every((n) => !stylist.includes(n)))

  check('facility_staff writes: scheduling + residents + services, NO stylist/roster/money writes',
    ['update_appointment', 'create_resident', 'update_resident', 'add_to_waitlist', 'add_signup_entry',
     'create_service', 'update_service', 'send_receipt'].every((n) => staff.includes(n))
    && ['set_stylist_hours', 'add_time_off', 'decide_time_off', 'update_stylist', 'reply_to_feedback',
        'get_resident_ledger', 'get_payroll_summary'].every((n) => !staff.includes(n)))

  check('bookkeeper writes: appointment corrections + ad-hoc service ONLY',
    ['update_appointment', 'create_service', 'book_appointment', 'cancel_appointment'].every((n) => bookkeeper.includes(n))
    && ['create_resident', 'update_resident', 'set_stylist_hours', 'add_time_off', 'decide_time_off',
        'add_to_waitlist', 'add_signup_entry', 'update_service', 'update_stylist', 'reply_to_feedback',
        'send_receipt'].every((n) => !bookkeeper.includes(n)))

  check('bookkeeper reads include ledger + payroll + waitlist',
    ['get_resident_ledger', 'get_payroll_summary', 'get_waitlist'].every((n) => bookkeeper.includes(n)))

  // ---- P41 additions ----
  check('switch_facility: master + bookkeeper ONLY',
    facilityMaster.includes('switch_facility') && bookkeeper.includes('switch_facility')
    && !admin.includes('switch_facility') && !staff.includes('switch_facility') && !stylist.includes('switch_facility'))
  check('explain_feature: every role except viewer',
    [admin, staff, bookkeeper, stylist, facilityMaster].every((set) => set.includes('explain_feature')))
}

// ---------------------------------------------------------------------------
// P41 — master facility resolution + help KB (DB-free paths). Async (tsx
// compiles to CJS — no top-level await), invoked from main().
async function p41Checks() {
  console.log('\n[1b] P41 — master facility resolution + help KB (DB-free paths)')
  // resolveCtxFacility: non-master args are IGNORED (no DB hit — returns ctx)
  const adminScoped = await resolveCtxFacility(baseCtx, { facilityName: 'Some Other Facility' })
  check('non-master facilityName IGNORED (ctx authoritative)', adminScoped.ok && adminScoped.ctx === baseCtx)

  const masterCtx: AssistantCtx = { ...baseCtx, role: 'master' }
  const masterNoArg = await resolveCtxFacility(masterCtx, {})
  check('master + selected facility + no arg → passthrough', masterNoArg.ok && masterNoArg.ctx === masterCtx)

  const masterSameCode = await resolveCtxFacility(masterCtx, { facilityName: 'f177' })
  check('master naming the selected F-code → passthrough (no lookup)', masterSameCode.ok && masterSameCode.ctx === masterCtx)

  const bareMaster = await resolveCtxFacility({ ...masterCtx, facilityId: null, facilityName: null, facilityCode: null }, {})
  check('facility-less master + no arg → asks which facility', !bareMaster.ok && bareMaster.error.includes('Which facility'))

  // Help KB: every guide id unique, and the how-to lookup finds the scan guide
  const ids = new Set(HELP_GUIDES.map((g) => g.id))
  check('help KB: unique guide ids', ids.size === HELP_GUIDES.length)
  const scanWords = normalizeWords('how do I record a log sheet')
  const best = [...HELP_GUIDES].sort((a, b) => scoreGuide(b, scanWords) - scoreGuide(a, scanWords))[0]
  check('"record a log sheet" resolves to a log guide', !!best && scoreGuide(best, scanWords) > 0 && /log/i.test(best.title))
  check('gibberish scores zero everywhere', HELP_GUIDES.every((g) => scoreGuide(g, normalizeWords('zzqx wvvk')) === 0))

  // explain_feature executes without a DB (pure KB lookup)
  const explain = ALL_TOOLS.find((t) => t.name === 'explain_feature')!
  const r1 = await explain.execute({ ...baseCtx, role: 'stylist', stylistId: 's1', stylistName: 'S' }, { topic: 'scan a log sheet' })
  check('explain_feature returns a guide body', typeof (r1.response.guide as { body?: string } | undefined)?.body === 'string')
  const r2 = await explain.execute(baseCtx, { topic: 'zzqx wvvk' })
  check('explain_feature no-match lists available topics', Array.isArray(r2.response.availableTopics))
  const r3 = await explain.execute({ ...baseCtx, role: 'stylist', stylistId: 's1', stylistName: 'S' }, { topic: 'quickbooks csv import' })
  check('role-gated guide hidden from stylist (QB imports)', !(r3.response.guide as { title?: string } | undefined)?.title?.includes('QuickBooks CSV'))

  // ---- P42 — model whitelist, grounding digest, creation tools, app links ----
  console.log('\n[1c] P42 — Quick/Smart + grounding + creation powers')
  check('MODEL_IDS whitelist maps fast→flash, smart→pro',
    MODEL_IDS.fast === 'gemini-2.5-flash' && MODEL_IDS.smart === 'gemini-2.5-pro' && Object.keys(MODEL_IDS).length === 2)

  const digest = buildGroundingDigest('bookkeeper')
  check('grounding digest under budget (<3.5KB)', digest.length < 3500)
  check('grounding digest highlights the caller role', digest.includes('YOU are helping') && digest.includes('Bookkeeper'))
  check('grounding digest carries the money rules', digest.includes('COMPLETED visits only') && digest.includes('never facility revenue') && digest.includes('show the math'))
  check('grounding digest covers all roles + pages', ['Master admin', 'Front desk', 'Stylist:', 'Daily Log', 'Payroll'].every((s) => digest.includes(s)))

  const createSignTool = ALL_TOOLS.find((t) => t.name === 'create_sign')!
  const bad = await createSignTool.execute(baseCtx, { template: 'evil-template' })
  check('create_sign rejects unknown template', typeof bad.response.error === 'string' && Array.isArray(bad.response.templates))
  const good = await createSignTool.execute(baseCtx, { template: 'closed-holiday', title: 'Closed Friday', body: 'See you Monday!\nHappy 4th' })
  const link = good.response.link as string
  check('create_sign returns a relative encoded /signage link',
    link.startsWith('/signage?template=closed-holiday') && link.includes('title=Closed+Friday') && !link.includes('\n'))
  check('create_sign link passes the chat allowlist', isAllowedAppLink(link))

  const names2 = (ctx: AssistantCtx) => toolsForCtx(ctx).map((t) => t.name)
  check('create_statement: billing roles only (bookkeeper yes, staff/stylist no)',
    names2({ ...baseCtx, role: 'bookkeeper' }).includes('create_statement')
    && !names2({ ...baseCtx, role: 'facility_staff' }).includes('create_statement')
    && !names2({ ...baseCtx, role: 'stylist', stylistId: 's1', stylistName: 'S' }).includes('create_statement'))
  check('create_sign: signage roles only (staff yes, bookkeeper no)',
    names2({ ...baseCtx, role: 'facility_staff' }).includes('create_sign')
    && !names2({ ...baseCtx, role: 'bookkeeper' }).includes('create_sign'))

  const segs = segmentMessage('Your sign is ready:\n/signage?template=welcome&title=Hi\nEnjoy!')
  check('segmentMessage links an allowlisted path', segs.some((s) => s.type === 'link' && s.value.startsWith('/signage?')))
  const ext = segmentMessage('Visit https://evil.example.com/signage now, or //evil.com/invoice/x')
  check('external + protocol-relative URLs are NEVER linkified', ext.every((s) => s.type === 'text'))
  const stmt = segmentMessage('Here: /api/billing/statement/11111111-2222-3333-4444-555555555555')
  check('statement path linkified', stmt.some((s) => s.type === 'link' && s.value.startsWith('/api/billing/statement/')))
  check('random api path NOT linkified', segmentMessage('see /api/residents please').every((s) => s.type === 'text'))
}

// ---------------------------------------------------------------------------
console.log('\n[2] Helpers')
{
  const items = [{ name: 'Edna Smith' }, { name: 'Edna Smythe' }, { name: 'Robert Johnson' }]
  const r1 = rankByName(items, 'Edna Smith')
  check('exact name ranks first', r1.scored[0]?.item.name === 'Edna Smith')
  const r2 = rankByName(items, 'Edna')
  check('similar names flagged ambiguous', r2.ambiguous === true)
  const r3 = rankByName(items, 'Johnson')
  check('surname-only matches uniquely', r3.scored[0]?.item.name === 'Robert Johnson' && !r3.ambiguous)

  // P38c — misspellings (word-overlap fuzzy scores these 0)
  check('levSimilarity catches "Adeel Kohen" → "Adele Cohen"', levSimilarity('Adele Cohen', 'Adeel Kohen') >= 0.7)
  const misspelled = rankByName([{ name: 'Adele Cohen' }, { name: 'Robert Johnson' }], 'Adeel kohen')
  check('rankByName surfaces the misspelled resident', misspelled.scored[0]?.item.name === 'Adele Cohen')
  check('unrelated name still filtered out', rankByName([{ name: 'Robert Johnson' }], 'Adeel kohen').scored.length === 0)

  const bad = parseLocalDateTime('tomorrow at 10', 'America/New_York')
  check('non-ISO local datetime rejected', 'error' in bad)
  const past = parseLocalDateTime('2020-01-01T10:00', 'America/New_York')
  check('past datetime rejected', 'error' in past && String((past as { error: string }).error).includes('past'))
  const future = new Date(Date.now() + 48 * 3600 * 1000)
  const iso = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}T10:00`
  const ok = parseLocalDateTime(iso, 'America/New_York')
  check('near-future datetime accepted', 'date' in ok)
}

// ---------------------------------------------------------------------------
console.log('\n[2b] computeOpenSlots (P39 slot math, facility-tz correct)')
{
  const tz = 'America/New_York'
  // 2026-08-03 is a Monday. Window Mon 09:00-11:00 → candidates 09:00, 09:30,
  // 10:00, 10:30 (duration 30 fits until 10:30).
  const windows = [{ dayOfWeek: 1, startTime: '09:00', endTime: '11:00' }]
  const base = {
    windows,
    offDates: new Set<string>(),
    startDate: '2026-08-03',
    days: 1,
    tz,
    durationMinutes: 30,
    now: fromDateTimeLocalInTz('2026-08-01T00:00', tz).getTime(),
  }
  const all = computeOpenSlots({ ...base, busy: [] })
  check('window steps at 30min and fits duration', all.length === 4 && all[0].dateTimeLocal === '2026-08-03T09:00' && all[3].dateTimeLocal === '2026-08-03T10:30')
  check('slots are FACILITY-local (09:00 ET = 13:00 UTC in Aug)', new Date(all[0].startUtcMs).toISOString() === '2026-08-03T13:00:00.000Z')

  const busyStart = fromDateTimeLocalInTz('2026-08-03T09:30', tz).getTime()
  const withBusy = computeOpenSlots({ ...base, busy: [{ start: busyStart, end: busyStart + 30 * 60_000 }] })
  check('busy interval knocks out the overlapping slot', withBusy.length === 3 && !withBusy.some((s) => s.dateTimeLocal.endsWith('09:30')))

  const dayOff = computeOpenSlots({ ...base, busy: [], offDates: new Set(['2026-08-03']) })
  check('time-off day yields zero slots', dayOff.length === 0)

  const pastNow = computeOpenSlots({ ...base, busy: [], now: fromDateTimeLocalInTz('2026-08-03T09:45', tz).getTime() })
  check('past slots dropped vs now', pastNow.length === 2 && pastNow[0].dateTimeLocal === '2026-08-03T10:00')

  const longSvc = computeOpenSlots({ ...base, busy: [], durationMinutes: 90 })
  check('90-min service only fits while it ends inside the window', longSvc.length === 2 && longSvc[1].dateTimeLocal === '2026-08-03T09:30')

  const multiDay = computeOpenSlots({ ...base, days: 8, busy: [] })
  check('multi-day scan finds the next week\'s Monday too', multiDay.length === 8)
}

// ---------------------------------------------------------------------------
console.log('\n[3] Gemini loop mechanics (fake transport + fake tools)')

const fakeRead: AssistantTool = {
  name: 'get_schedule',
  description: 'fake',
  parameters: { type: 'OBJECT', properties: {} },
  kind: 'read',
  roles: ['admin'],
  needsFacility: true,
  async execute() {
    return { response: { rows: [{ bookingId: 'b1', resident: 'Edna Smith' }] } }
  },
}
const fakeWrite: AssistantTool = {
  name: 'book_appointment',
  description: 'fake',
  parameters: { type: 'OBJECT', properties: {} },
  kind: 'write',
  roles: ['admin'],
  needsFacility: true,
  async execute() {
    return {
      response: { proposed: true, summary: 'Edna Smith — Wash & Set' },
      pendingAction: {
        kind: 'book' as const,
        summary: { title: 'Book appointment?', lines: ['Edna Smith'] },
        request: { method: 'POST' as const, path: '/api/bookings', body: { residentId: 'r1' } },
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
    }
  },
}

type Req = Record<string, unknown>
function scriptedTransport(script: Array<(body: Req) => unknown>): { transport: GeminiTransport; calls: Req[] } {
  const calls: Req[] = []
  let i = 0
  const transport: GeminiTransport = async (body) => {
    calls.push(body)
    const step = script[Math.min(i, script.length - 1)]
    i++
    return step(body) as ReturnType<GeminiTransport> extends Promise<infer R> ? R : never
  }
  return { transport, calls }
}

const text = (t: string) => ({ candidates: [{ content: { role: 'model', parts: [{ text: t }] } }] })
const call = (name: string, args: Record<string, unknown>, sig?: string) => ({
  candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args }, ...(sig ? { thoughtSignature: sig } : {}) }] } }],
})

async function main() {
  await p41Checks()

  // ---- P43 — identity in the preamble: the assistant knows WHO it serves ----
  console.log('\n[1d] P43 — user identity + owner-never-demoted preamble')
  {
    const firstText = (calls: Req[]) => {
      const c = calls[0] as { contents: Array<{ parts: Array<{ text?: string }> }> }
      return c.contents[0].parts[0].text ?? ''
    }

    const masterCtx: AssistantCtx = { ...baseCtx, role: 'master', userName: 'Josh Gerhardt' }
    const t1 = scriptedTransport([() => text('ok')])
    await runAssistant(masterCtx, 'hi', [], [fakeRead], 'fast', t1.transport)
    const p1 = firstText(t1.calls)
    check('master preamble names the user + OWNER', p1.includes('Josh Gerhardt') && p1.includes('OWNER of the entire Senior Stylist network'))
    check('master preamble forbids the access-denial deflection', p1.includes('Never tell them they lack access'))

    const t2 = scriptedTransport([() => text('ok')])
    await runAssistant(baseCtx, 'hi', [], [fakeRead], 'fast', t2.transport)
    const p2 = firstText(t2.calls)
    check('admin preamble names the user, NOT owner', p2.includes('Josh Gerhardt') && !p2.includes('OWNER of the entire'))

    const debugCtx: AssistantCtx = { ...baseCtx, role: 'stylist', stylistId: 's1', stylistName: 'Senait', debugPreview: true }
    const t3 = scriptedTransport([() => text('ok')])
    await runAssistant(debugCtx, 'hi', [], [fakeRead], 'fast', t3.transport)
    const p3 = firstText(t3.calls)
    check('debug-preview preamble carries the Debug note', p3.includes('Debug Mode') && p3.includes('amber badge'))
    check('non-debug preamble has NO Debug note', !p1.includes('Debug Mode') && !p2.includes('Debug Mode'))
    check('claim-mismatch rule present (session is authoritative)', p1.includes('AUTHORITATIVE about who the user is'))

    // ---- P44 — firm refusal posture + memory blocks + memory tools ----
    console.log('\n[1e] P44 — role posture + memory')
    check('firm non-owner escalation refusal present', p2.includes('refuse the escalation FIRMLY') && p2.includes('never simulate elevated access'))

    const memCtx: AssistantCtx = {
      ...baseCtx,
      memories: ['Prefers money shown by month'],
      sharedMemories: ['Always offer to log services for stylists'],
    }
    const t4 = scriptedTransport([() => text('ok')])
    await runAssistant(memCtx, 'hi', [], [fakeRead], 'fast', t4.transport)
    const p4 = firstText(t4.calls)
    check('preamble carries the user memory block', p4.includes('What you remember about Josh Gerhardt') && p4.includes('Prefers money shown by month'))
    check('preamble carries owner standing instructions', p4.includes('Standing instructions from the owner') && p4.includes('Always offer to log services'))
    check('memory blocks absent when empty', !p2.includes('What you remember about') && !p2.includes('Standing instructions'))

    const names3 = (c: AssistantCtx) => toolsForCtx(c).map((t) => t.name)
    const stylistTools = names3({ ...baseCtx, role: 'stylist', stylistId: 's1', stylistName: 'S' })
    const masterTools = names3({ ...baseCtx, role: 'master' })
    check('manage_memory: every role except viewer', stylistTools.includes('manage_memory') && masterTools.includes('manage_memory'))
    check('suggest_shared_learning: non-master only (masters write directly)',
      stylistTools.includes('suggest_shared_learning') && !masterTools.includes('suggest_shared_learning'))

    const memTool = ALL_TOOLS.find((t) => t.name === 'manage_memory')!
    const badAction = await memTool.execute(baseCtx, { action: 'obliterate', content: 'x' })
    check('manage_memory rejects unknown action (pure, pre-DB)', typeof badAction.response.error === 'string')
    const noContent = await memTool.execute(baseCtx, { action: 'remember', content: '   ' })
    check('manage_memory rejects empty content (pure, pre-DB)', typeof noContent.response.error === 'string')
    const suggestTool = ALL_TOOLS.find((t) => t.name === 'suggest_shared_learning')!
    const noLearn = await suggestTool.execute(baseCtx, { content: '' })
    check('suggest_shared_learning rejects empty content (pure, pre-DB)', typeof noLearn.response.error === 'string')

    // ---- P45 — coworker mode: guide vocabulary + walk validation ----
    console.log('\n[1f] P45 — guided walks (coworker mode)')
    check('anchor vocabulary is non-trivial + digest builds', Object.keys(GUIDE_ANCHORS).length >= 60 && buildAnchorVocab().includes('/log'))

    const goodWalk = validateWalkSteps([
      { action: 'click', anchor: 'nav-daily-log', instruction: 'Tap the Daily Log tab.' },
      { action: 'point', anchor: 'daily-log-scan-sheet', instruction: 'This camera button opens the scanner.' },
      { action: 'click', anchor: 'daily-log-scan-sheet', instruction: 'Tap it to open the scanner.' },
      { action: 'point', anchor: 'ocr-upload-area', instruction: 'Add your photos here.' },
    ])
    check('valid walk passes + maps to engine steps', goodWalk.ok && goodWalk.steps.length === 4
      && goodWalk.steps[0].selector === '[data-tour="nav-daily-log"]' && goodWalk.steps[0].type === 'click')
    check('anchor route stamped for navigation', goodWalk.ok && goodWalk.steps[1].route === '/log' && !goodWalk.steps[0].route)

    const badAnchor = validateWalkSteps([{ action: 'click', anchor: 'made-up-thing', instruction: 'x' }])
    check('unknown anchor rejected', !badAnchor.ok && badAnchor.error.includes('unknown anchor'))
    const noOpener = validateWalkSteps([{ action: 'point', anchor: 'ocr-upload-area', instruction: 'x' }])
    check('conditional anchor without its opener rejected', !noOpener.ok && noOpener.error.includes('daily-log-scan-sheet'))
    const noValue = validateWalkSteps([{ action: 'type', anchor: 'residents-search', instruction: 'x' }])
    check('type step without typeValue rejected', !noValue.ok)
    const tooMany = validateWalkSteps(Array.from({ length: 13 }, () => ({ action: 'point' as const, instruction: 'x' })))
    check('walks capped at 12 steps', !tooMany.ok)
    const badRoute = validateWalkSteps([{ action: 'point', instruction: 'x', route: '/api/evil' }])
    check('non-app route rejected', !badRoute.ok)

    const walkTool = ALL_TOOLS.find((t) => t.name === 'start_guided_walk')!
    check('start_guided_walk: every role except viewer', stylistTools.includes('start_guided_walk') && masterTools.includes('start_guided_walk'))
    const badWalk = await walkTool.execute(baseCtx, { title: 'x', steps: [{ action: 'click', anchor: 'nope', instruction: 'x' }] })
    check('tool returns vocabulary on rejection', typeof badWalk.response.error === 'string' && typeof badWalk.response.anchorsByPage === 'string')
    const okWalk = await walkTool.execute(baseCtx, {
      title: 'Scan a sheet',
      steps: [{ action: 'click', anchor: 'nav-daily-log', instruction: 'Tap Daily Log.' }],
    })
    check('tool returns a guide payload on success', okWalk.response.walkStarted === true && okWalk.guide?.steps.length === 1)

    // Guide flows through the Gemini loop like pendingAction (first wins).
    const fakeGuideTool: AssistantTool = {
      name: 'fake_guide',
      description: 'x',
      parameters: { type: 'OBJECT', properties: {} },
      kind: 'read',
      roles: ['admin'],
      needsFacility: false,
      async execute() {
        return {
          response: { ok: true },
          guide: { title: 'Walk A', steps: [{ type: 'highlight', selector: '', title: 't', description: 'd' }] },
        }
      },
    }
    const gt = scriptedTransport([
      () => call('fake_guide', {}),
      () => call('fake_guide', {}),
      () => text('Going!'),
    ])
    const gr = await runAssistant(baseCtx, 'guide me', [], [fakeGuideTool], 'fast', gt.transport)
    check('guide captured through the loop (first wins)', gr?.guide?.title === 'Walk A' && gr?.answer === 'Going!')
  }

  // ---- P46 — streaming status, page chips, growth tools ----
  console.log('\n[1g] P46 — status labels + onEvent + chips + growth tools')
  {
    check('every registered tool has a friendly status label', ALL_TOOLS.every((t) => hasStatusLabel(t.name)))
    check('unknown tool falls back to the default label', statusLabelFor('made_up_tool') === 'Working on it…')

    // onEvent fires once per tool dispatch with the friendly label.
    const events: string[] = []
    const et = scriptedTransport([
      () => call('get_schedule', { date: '2026-07-23' }),
      () => text('Your day is clear.'),
    ])
    const er = await runAssistant(baseCtx, 'my day?', [], [fakeRead], 'fast', et.transport, (e) => {
      if (e.type === 'status') events.push(e.label)
    })
    check('onEvent streamed the tool status label', events.length === 1 && events[0] === 'Checking the schedule…' && er?.answer === 'Your day is clear.')

    // Page-aware chips: prefix matching, specific-before-general, empty fallbacks.
    check('/log gets scan-a-sheet chips', chipsForPage('/log').some((c) => c.toLowerCase().includes('scan')))
    check('/billing/monthly beats the /billing prefix', chipsForPage('/billing/monthly')[0] !== chipsForPage('/billing')[0])
    check('unknown page + null → no page chips', chipsForPage('/nowhere').length === 0 && chipsForPage(null).length === 0)

    // New industry tools: role filters.
    const names46 = (c: AssistantCtx) => toolsForCtx(c).map((t) => t.name)
    const admin46 = names46(baseCtx)
    const staff46 = names46({ ...baseCtx, role: 'facility_staff' })
    const stylist46 = names46({ ...baseCtx, role: 'stylist', stylistId: 's1', stylistName: 'S' })
    const bookkeeper46 = names46({ ...baseCtx, role: 'bookkeeper' })
    const master46 = names46({ ...baseCtx, role: 'master' })
    check('get_rebooking_candidates: admin/staff/master only',
      [admin46, staff46, master46].every((s) => s.includes('get_rebooking_candidates'))
      && !stylist46.includes('get_rebooking_candidates') && !bookkeeper46.includes('get_rebooking_candidates'))
    check('get_schedule_gaps: admin/staff/stylist/master, NOT bookkeeper',
      [admin46, staff46, stylist46, master46].every((s) => s.includes('get_schedule_gaps'))
      && !bookkeeper46.includes('get_schedule_gaps'))

    // Growth routing hint rides the preamble when the tools are present.
    const ht = scriptedTransport([() => text('ok')])
    await runAssistant(baseCtx, 'hi', [], toolsForCtx(baseCtx), 'fast', ht.transport)
    const hp = (ht.calls[0] as { contents: Array<{ parts: Array<{ text?: string }> }> }).contents[0].parts[0].text ?? ''
    check('preamble routes gaps + rebooking + morning brief', hp.includes('get_schedule_gaps') && hp.includes('get_rebooking_candidates') && hp.includes('morning brief'))
  }

  // ---- P47 — rich answer cards (builders + validator + loop channel) ----
  console.log('\n[1h] P47 — answer cards')
  {
    const RID = '11111111-2222-3333-4444-555555555555'
    const sched = scheduleCard('2026-07-23', [
      { when: 'Thu, Jul 23 · 10:00 AM', resident: 'Edna Smith', residentId: RID, room: '12', service: 'Wash & Set', stylist: 'Sarah', status: 'scheduled' },
      { when: 'Thu, Jul 23 · 11:00 AM', resident: 'Unknown', residentId: null, room: null, service: 'Haircut', stylist: null, status: 'scheduled' },
    ])
    check('scheduleCard: table with resident entity only when id present',
      sched?.kind === 'table' && sched.rows.length === 2
      && sched.rows[0][1].entity?.type === 'resident' && sched.rows[0][1].entity?.id === RID
      && sched.rows[1][1].entity === undefined && sched.rows[0][0].text === '10:00 AM')
    check('scheduleCard: empty input → null', scheduleCard('2026-07-23', []) === null)
    const bigRows = Array.from({ length: 20 }, (_, i) => ({
      when: `· ${i}`, resident: `R${i}`, room: null, service: 'S', stylist: null, status: 'scheduled',
    }))
    const capped = scheduleCard('2026-07-23', bigRows)
    check('scheduleCard: rows capped at MAX_CARD_ROWS', capped?.kind === 'table' && capped.rows.length === MAX_CARD_ROWS)

    const money = moneyPackCards({
      scope: 'facility',
      facility: { name: 'Sunrise' },
      revenue: { thisMonthCents: 123456, thisMonthVisits: 42, lastMonthCents: 100, lastMonthVisits: 1 },
      billing: {
        openInvoicesTotalCents: 550000, collectedLast30DaysCents: 20000,
        topOpenResidentBalances: [
          { residentId: RID, resident: 'Edna Smith', owedCents: 12345 },
          { residentId: null, resident: 'Unattributed', owedCents: 1 },
        ],
      },
    })
    check('moneyPackCards(facility): stats + top-balances table with entity',
      money.length === 2 && money[0].kind === 'stats'
      && money[0].stats[0].value === '$1,234.56'
      && money[1].kind === 'table' && money[1].rows[0][0].entity?.id === RID && money[1].rows[1][0].entity === undefined)
    const net = moneyPackCards({
      scope: 'network',
      totals: { facilities: 3, monthToDateRevenueCents: 100, monthToDateVisits: 2, openBalanceCents: 300, collectedLast30DaysCents: 400 },
      facilities: [
        { facility: 'A', openBalanceCents: 100, monthToDateRevenueCents: 5 },
        { facility: 'B', openBalanceCents: 900, monthToDateRevenueCents: 6 },
      ],
    })
    check('moneyPackCards(network): facilities sorted by open balance', net[1].kind === 'table' && net[1].rows[0][0].text === 'B')

    const rb = rebookingCard([{ resident: 'E', residentId: RID, room: '9', lastVisit: 'Jul 1', daysSinceLastVisit: 30, usualCadenceDays: 21, usualService: 'Perm' }])
    const gp = gapsCard('2026-07-23', [{ stylist: 'Sarah', stylistId: RID, blocks: [{ from: '2:00 PM', to: '3:30 PM', minutes: 90 }] }])
    check('rebookingCard + gapsCard carry entities',
      rb?.kind === 'list' && rb.items[0].entity?.type === 'resident'
      && gp?.kind === 'list' && gp.items[0].entity?.type === 'stylist')

    // Validator matrix
    check('isAnswerCard accepts every builder output',
      [sched, ...money, ...net].filter(Boolean).every((c) => isAnswerCard(c)))
    check('isAnswerCard rejects junk',
      !isAnswerCard(null) && !isAnswerCard({ kind: 'table', title: 't' })
      && !isAnswerCard({ kind: 'chart', title: 't', rows: [] })
      && !isAnswerCard({ kind: 'list', title: 't', items: [{ text: 'x', entity: { type: 'facility', id: RID } }] })
      && !isAnswerCard({ kind: 'list', title: 't', items: [{ text: 'x', entity: { type: 'resident', id: 'not-a-uuid' } }] }))

    // Loop channel: cards ACCUMULATE across tool calls, capped, model told once per accepting response.
    const cardTool = (name: string, n: number): AssistantTool => ({
      name, description: 'x', parameters: { type: 'OBJECT', properties: {} }, kind: 'read', roles: ['admin'], needsFacility: false,
      async execute() {
        return {
          response: { ok: true },
          cards: Array.from({ length: n }, (_, i) => ({ kind: 'stats' as const, title: `${name}-${i}`, stats: [{ label: 'x', value: 'y' }] })),
        }
      },
    })
    const ct = scriptedTransport([
      () => call('tool_a', {}),
      () => call('tool_b', {}),
      () => text('Here you go.'),
    ])
    const cr = await runAssistant(baseCtx, 'numbers?', [], [cardTool('tool_a', 2), cardTool('tool_b', 2)], 'fast', ct.transport)
    check('cards accumulate across calls and cap at 3', cr?.cards.length === 3 && cr.cards[0].title === 'tool_a-0' && cr.cards[2].title === 'tool_b-0')
    const echo2 = JSON.stringify(ct.calls[1])
    check('accepting functionResponse carries the _card short-prose note', echo2.includes('_card') && echo2.includes('do NOT repeat'))
    const cp = (ct.calls[0] as { contents: Array<{ parts: Array<{ text?: string }> }> }).contents[0].parts[0].text ?? ''
    check('preamble teaches the card-attached prose rule', cp.includes('visual card'))
  }

  // ---- P47 — token-level streaming (SSE parse, assembler invariant, loop) ----
  console.log('\n[1i] P47 — token streaming')
  {
    // parseSseChunk edge matrix
    const got: string[] = []
    let rest = parseSseChunk('data: {"a":1}\n\ndata: {"b"', (j) => got.push(j))
    check('parseSseChunk: complete line emitted, partial retained', got.length === 1 && got[0] === '{"a":1}' && rest === 'data: {"b"')
    rest = parseSseChunk(rest + ':2}\r\n: comment\nevent: x\ndata: [DONE]\n', (j) => got.push(j))
    check('parseSseChunk: split-across-reads + CRLF + comments + DONE', got.length === 2 && got[1] === '{"b":2}' && rest === '')

    // Assembler: unsigned text concatenates; signed/functionCall parts append WHOLE.
    const asm = createStreamAssembler()
    const chunk = (parts: Array<Record<string, unknown>>) => ({ candidates: [{ content: { role: 'model' as const, parts } }] })
    asm.push(chunk([{ text: 'Hel' }]))
    asm.push(chunk([{ text: 'lo ' }]))
    asm.push(chunk([{ text: 'world', thoughtSignature: 'SIGTEXT' }]))
    asm.push(chunk([{ functionCall: { name: 'get_schedule', args: { date: 'x' } }, thoughtSignature: 'SIGCALL' }]))
    asm.push(chunk([{ text: 'tail' }]))
    const assembled = asm.result()
    const parts = assembled.candidates?.[0]?.content?.parts ?? []
    check('assembler: unsigned text merged, signed text NOT merged',
      parts.length === 4 && parts[0].text === 'Hello ' && parts[1].text === 'world' && parts[1].thoughtSignature === 'SIGTEXT')
    check('assembler: functionCall appended whole with signature intact',
      parts[2].functionCall?.name === 'get_schedule' && parts[2].thoughtSignature === 'SIGCALL' && parts[3].text === 'tail')

    // Scripted stream transport: text round streams tokens; tool round resets.
    const sseRound = (chunks: Array<Record<string, unknown>>) => (onChunk: (c: Record<string, unknown>) => void) => {
      const a = createStreamAssembler()
      for (const c of chunks) {
        a.push(c as never)
        onChunk(c)
      }
      return a.result()
    }
    const rounds = [
      sseRound([
        chunk([{ text: 'Loo' }]),
        chunk([{ text: 'king…' }]),
        chunk([{ functionCall: { name: 'get_schedule', args: { date: '2026-07-23' } }, thoughtSignature: 'S1' }]),
      ]),
      sseRound([chunk([{ text: 'You have ' }]), chunk([{ text: '1 appointment.' }])]),
    ]
    let ri = 0
    const streamCalls: Array<Record<string, unknown>> = []
    const fakeStream = async (body: Record<string, unknown>, onChunk: (c: never) => void) => {
      streamCalls.push(body)
      return rounds[Math.min(ri++, rounds.length - 1)](onChunk as never) as never
    }
    const sevents: Array<{ type: string; text?: string }> = []
    const sr = await runAssistant(baseCtx, 'my day?', [], [fakeRead], 'fast', undefined, (e) => {
      sevents.push(e as { type: string; text?: string })
    }, fakeStream)
    const tokens = sevents.filter((e) => e.type === 'token').map((e) => e.text).join('')
    check('stream loop: final answer = token concatenation', sr?.answer === 'You have 1 appointment.' && tokens.endsWith('You have 1 appointment.'))
    check('tool-round tokens reset exactly once before the call',
      sevents.filter((e) => e.type === 'token_reset').length === 1)
    const echoed = JSON.stringify((streamCalls[1] as { contents: unknown[] }).contents)
    check('assembled tool round echoed with signature (verbatim contract)', echoed.includes('S1') && echoed.includes('get_schedule'))
  }

  // 3a — plain text answer
  {
    const { transport } = scriptedTransport([() => text('Hello!')])
    const r = await runAssistant(baseCtx, 'hi', [], [fakeRead], 'fast', transport)
    check('text-only answer returned', r?.answer === 'Hello!')
    check('no pendingAction on read-only turn', r?.pendingAction == null)
  }

  // 3b — tool round-trip with verbatim echo (thoughtSignature survives)
  {
    const { transport, calls } = scriptedTransport([
      () => call('get_schedule', { date: '2026-07-22' }, 'SIG123'),
      () => text('You have 1 appointment.'),
    ])
    const r = await runAssistant(baseCtx, 'my day?', [], [fakeRead], 'fast', transport)
    check('answer after tool round', r?.answer === 'You have 1 appointment.')
    const second = calls[1] as { contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> }
    const echoed = second.contents[1]
    check('model content echoed verbatim (thoughtSignature intact)', JSON.stringify(echoed).includes('SIG123'))
    const fr = second.contents[2]
    check('functionResponse in role:user content', fr.role === 'user' && !!fr.parts[0].functionResponse)
    const frObj = fr.parts[0].functionResponse as { name: string; response: Record<string, unknown> }
    check('functionResponse is an OBJECT with rows', frObj.name === 'get_schedule' && Array.isArray(frObj.response.rows))
  }

  // 3c — parallel calls answered in order
  {
    const parallel = {
      candidates: [{
        content: {
          role: 'model',
          parts: [
            { functionCall: { name: 'get_schedule', args: {} } },
            { functionCall: { name: 'book_appointment', args: {} } },
          ],
        },
      }],
    }
    const { transport, calls } = scriptedTransport([() => parallel, () => text('Done.')])
    const r = await runAssistant(baseCtx, 'book it', [], [fakeRead, fakeWrite], 'fast', transport)
    const second = calls[1] as { contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> }
    const frParts = second.contents[2].parts
    check('parallel calls → 2 ordered functionResponses', frParts.length === 2 &&
      (frParts[0].functionResponse as { name: string }).name === 'get_schedule' &&
      (frParts[1].functionResponse as { name: string }).name === 'book_appointment')
    check('write tool produced pendingAction', r?.pendingAction?.kind === 'book')
  }

  // 3d — one action per message
  {
    const twoWrites = [
      () => call('book_appointment', {}),
      () => call('book_appointment', {}),
      () => text('Confirm below.'),
    ]
    const { transport, calls } = scriptedTransport(twoWrites)
    const r = await runAssistant(baseCtx, 'book two', [], [fakeWrite], 'fast', transport)
    const third = calls[2] as { contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> }
    const secondResponse = third.contents[4].parts[0].functionResponse as { response: Record<string, unknown> }
    check('second write refused with one_action_per_message', String(secondResponse.response.error ?? '').includes('one_action_per_message'))
    check('only the FIRST proposal is kept', r?.pendingAction != null)
  }

  // 3e — MALFORMED_FUNCTION_CALL retried once, then answer
  {
    const { transport, calls } = scriptedTransport([
      () => ({ candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'MALFORMED_FUNCTION_CALL' }] }),
      () => text('Recovered.'),
    ])
    const r = await runAssistant(baseCtx, 'hi', [], [fakeRead], 'fast', transport)
    check('malformed call retried once then answered', r?.answer === 'Recovered.' && calls.length === 2)
  }

  // 3f — round budget exhausted → forced text (mode NONE)
  {
    const { transport, calls } = scriptedTransport([
      () => call('get_schedule', {}),
      () => call('get_schedule', {}),
      () => call('get_schedule', {}),
      () => call('get_schedule', {}),
      () => call('get_schedule', {}),
      () => call('get_schedule', {}),
      (body) => {
        const cfg = (body as { toolConfig?: { functionCallingConfig?: { mode?: string } } }).toolConfig
        return cfg?.functionCallingConfig?.mode === 'NONE' ? text('Forced summary.') : call('get_schedule', {})
      },
    ])
    const r = await runAssistant(baseCtx, 'loop forever', [], [fakeRead], 'fast', transport)
    check('forced-text round after budget (mode NONE)', r?.answer === 'Forced summary.')
    const last = calls[calls.length - 1] as { toolConfig?: { functionCallingConfig?: { mode?: string } } }
    check('final call used mode NONE', last.toolConfig?.functionCallingConfig?.mode === 'NONE')
  }

  // 3g — unknown tool → error functionResponse, model recovers
  {
    const { transport, calls } = scriptedTransport([
      () => call('made_up_tool', {}),
      () => text('Sorry, I cannot do that.'),
    ])
    const r = await runAssistant(baseCtx, 'weird', [], [fakeRead], 'fast', transport)
    const second = calls[1] as { contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> }
    const fr = second.contents[2].parts[0].functionResponse as { response: Record<string, unknown> }
    check('unknown tool → error fed back, answer still produced', String(fr.response.error ?? '').includes('Unknown tool') && r?.answer === 'Sorry, I cannot do that.')
  }

  // -------------------------------------------------------------------------
  console.log('\n[4] ACTION_RULES allowlist coverage (shared client gate)')
  {
    const UUID = '11111111-2222-3333-4444-555555555555'
    const mk = (kind: AssistantActionKind, method: PendingAction['request']['method'], path: string, body: Record<string, unknown> | null): PendingAction => ({
      kind,
      summary: { title: 't', lines: [] },
      request: { method, path, body },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })

    // Every write kind has a rule (Record<> enforces at compile time; assert at runtime too).
    const kinds = Object.keys(ACTION_RULES) as AssistantActionKind[]
    check('all 17 action kinds have rules', kinds.length === 17)

    // A canonical well-formed proposal per kind passes the gate.
    const canonical: Record<AssistantActionKind, PendingAction> = {
      book: mk('book', 'POST', '/api/bookings', { residentId: UUID, serviceId: UUID, startTime: 'x', stylistId: UUID }),
      cancel: mk('cancel', 'DELETE', `/api/bookings/${UUID}`, null),
      reschedule: mk('reschedule', 'PUT', `/api/bookings/${UUID}`, { startTime: 'x' }),
      update_appointment: mk('update_appointment', 'PUT', `/api/bookings/${UUID}`, { status: 'completed', paymentStatus: 'paid', tipCents: 1000, notes: 'n' }),
      create_resident: mk('create_resident', 'POST', '/api/residents', { name: 'Joann Horn', roomNumber: '12' }),
      update_resident: mk('update_resident', 'PUT', `/api/residents/${UUID}`, { roomNumber: '14', poaPhone: '555' }),
      set_stylist_hours: mk('set_stylist_hours', 'PUT', '/api/availability', { stylistId: UUID, facilityId: UUID, availability: [] }),
      add_time_off: mk('add_time_off', 'POST', '/api/coverage', { stylistId: UUID, startDate: '2026-08-01', endDate: '2026-08-02', reason: 'r' }),
      decide_time_off: mk('decide_time_off', 'PUT', `/api/coverage/${UUID}`, { action: 'approve' }),
      add_to_waitlist: mk('add_to_waitlist', 'POST', '/api/waitlist', { residentId: UUID, residentName: 'X', earliestDate: '2026-08-01' }),
      add_signup_entry: mk('add_signup_entry', 'POST', '/api/signup-sheet', { residentId: UUID, residentName: 'X', serviceName: 'Cut', requestedDate: '2026-08-01' }),
      create_service: mk('create_service', 'POST', '/api/services', { name: 'S/B Dry', priceCents: 4500 }),
      update_service: mk('update_service', 'PUT', `/api/services/${UUID}`, { priceCents: 5000, active: true }),
      update_stylist: mk('update_stylist', 'PUT', `/api/stylists/${UUID}`, { commissionPercent: 50 }),
      reply_to_feedback: mk('reply_to_feedback', 'PATCH', `/api/feedback/${UUID}`, { reply: 'Fixed!', status: 'resolved' }),
      send_receipt: mk('send_receipt', 'POST', `/api/bookings/${UUID}/receipt`, null),
      switch_facility: mk('switch_facility', 'POST', '/api/facilities/select', { facilityId: UUID }),
    }
    check('canonical proposal per kind passes actionAllowed', kinds.every((k) => actionAllowed(canonical[k])))

    // Violations are rejected: wrong method, foreign path, smuggled body key.
    check('wrong method rejected', !actionAllowed({ ...canonical.cancel, request: { ...canonical.cancel.request, method: 'POST' } }))
    check('foreign path rejected', !actionAllowed({ ...canonical.book, request: { ...canonical.book.request, path: '/api/facilities' } }))
    check('path traversal rejected', !actionAllowed({ ...canonical.cancel, request: { ...canonical.cancel.request, path: `/api/bookings/${UUID}/../../facility` } }))
    check('smuggled body key rejected (reschedule + priceCents)', !actionAllowed({ ...canonical.reschedule, request: { ...canonical.reschedule.request, body: { startTime: 'x', priceCents: 0 } } }))
    check('smuggled body key rejected (update_resident + name)', !actionAllowed({ ...canonical.update_resident, request: { ...canonical.update_resident.request, body: { roomNumber: '14', name: 'Renamed' } } }))
    check('smuggled body key rejected (update_stylist + commission path abuse)', !actionAllowed({ ...canonical.update_stylist, request: { ...canonical.update_stylist.request, body: { commissionPercent: 50, email: 'x@y.z' } } }))
    check('non-uuid id rejected', !actionAllowed({ ...canonical.update_service, request: { ...canonical.update_service.request, path: '/api/services/bulk-update' } }))
    check('unknown kind rejected', !actionAllowed({ ...canonical.book, kind: 'delete_everything' as AssistantActionKind }))
  }

  console.log(failures === 0 ? '\nAll assistant harness checks passed.' : `\n${failures} FAILURES`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
