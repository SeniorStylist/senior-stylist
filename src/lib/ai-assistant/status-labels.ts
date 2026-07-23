// P46 — friendly live-status labels streamed to the chat while the
// assistant works ("Crunching the numbers…" instead of a frozen spinner —
// the single biggest perceived-speed lever from the copilot-UX research).
// Pure module; harness asserts every registered tool resolves to a label.

const LABELS: Record<string, string> = {
  get_schedule: 'Checking the schedule…',
  find_resident: 'Looking up the resident…',
  list_services: 'Checking the service menu…',
  find_open_slots: 'Finding open times…',
  get_business_numbers: 'Crunching the numbers…',
  get_facility_numbers: 'Crunching the numbers…',
  get_my_earnings: 'Adding up your earnings…',
  get_resident_ledger: 'Pulling up the ledger…',
  get_stylist_info: 'Looking up the stylist…',
  get_time_off_requests: 'Checking time-off requests…',
  get_waitlist: 'Checking the waitlist…',
  get_signup_queue: 'Checking sign-up requests…',
  get_payroll_summary: 'Reviewing payroll…',
  get_feedback_inbox: 'Checking feedback…',
  explain_feature: 'Looking that up…',
  manage_memory: 'Saving that…',
  suggest_shared_learning: 'Noting that down…',
  start_guided_walk: 'Building your walkthrough…',
  create_sign: 'Making your sign…',
  create_statement: 'Preparing the document…',
  book_appointment: 'Setting up the booking…',
  cancel_appointment: 'Preparing the cancellation…',
  reschedule_appointment: 'Preparing the reschedule…',
  update_appointment: 'Preparing the update…',
  create_resident: 'Preparing the new resident…',
  update_resident: 'Preparing the update…',
  set_stylist_hours: 'Drafting the schedule…',
  add_time_off: 'Preparing the time off…',
  decide_time_off: 'Preparing the decision…',
  add_to_waitlist: 'Adding to the waitlist…',
  add_signup_entry: 'Adding the request…',
  create_service: 'Preparing the service…',
  update_service: 'Preparing the update…',
  update_stylist: 'Preparing the update…',
  reply_to_feedback: 'Drafting the reply…',
  send_receipt: 'Preparing the receipt…',
  switch_facility: 'Getting the switch ready…',
  get_rebooking_candidates: 'Finding who’s due for a visit…',
  get_schedule_gaps: 'Scanning for open gaps…',
}

export function statusLabelFor(toolName: string): string {
  return LABELS[toolName] ?? 'Working on it…'
}

export function hasStatusLabel(toolName: string): boolean {
  return toolName in LABELS
}
