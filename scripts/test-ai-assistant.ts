// P38 — keyless test harness for the AI assistant.
// Run: npx tsx scripts/test-ai-assistant.ts
// No GEMINI_API_KEY and no DB needed: registry filtering + helpers are pure,
// and the Gemini loop runs against a scripted fake transport with fake tools.

import { toolsForCtx, rankByName, parseLocalDateTime, type AssistantCtx, type AssistantTool } from '../src/lib/ai-assistant/tools'
import { runAssistant, type GeminiTransport } from '../src/lib/ai-assistant/gemini'

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
  timezone: 'America/New_York',
  stylistId: null,
  stylistName: null,
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

  const plainMaster = names({ ...baseCtx, role: 'master', facilityId: null, facilityName: null })
  check('plain master (no facility): only network-capable tools', plainMaster.every((n) => ['get_business_numbers', 'get_facility_numbers'].includes(n)) && plainMaster.length === 2)

  const facilityMaster = names({ ...baseCtx, role: 'master' })
  check('master with facility selected: schedule + writes too', ['get_schedule', 'find_resident', 'book_appointment', 'get_facility_numbers'].every((n) => facilityMaster.includes(n)))
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
  // 3a — plain text answer
  {
    const { transport } = scriptedTransport([() => text('Hello!')])
    const r = await runAssistant(baseCtx, 'hi', [], [fakeRead], transport)
    check('text-only answer returned', r?.answer === 'Hello!')
    check('no pendingAction on read-only turn', r?.pendingAction == null)
  }

  // 3b — tool round-trip with verbatim echo (thoughtSignature survives)
  {
    const { transport, calls } = scriptedTransport([
      () => call('get_schedule', { date: '2026-07-22' }, 'SIG123'),
      () => text('You have 1 appointment.'),
    ])
    const r = await runAssistant(baseCtx, 'my day?', [], [fakeRead], transport)
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
    const r = await runAssistant(baseCtx, 'book it', [], [fakeRead, fakeWrite], transport)
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
    const r = await runAssistant(baseCtx, 'book two', [], [fakeWrite], transport)
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
    const r = await runAssistant(baseCtx, 'hi', [], [fakeRead], transport)
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
    const r = await runAssistant(baseCtx, 'loop forever', [], [fakeRead], transport)
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
    const r = await runAssistant(baseCtx, 'weird', [], [fakeRead], transport)
    const second = calls[1] as { contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> }
    const fr = second.contents[2].parts[0].functionResponse as { response: Record<string, unknown> }
    check('unknown tool → error fed back, answer still produced', String(fr.response.error ?? '').includes('Unknown tool') && r?.answer === 'Sorry, I cannot do that.')
  }

  console.log(failures === 0 ? '\nAll assistant harness checks passed.' : `\n${failures} FAILURES`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
