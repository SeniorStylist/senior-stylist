export type ScriptedStepType = 'highlight' | 'type' | 'click' | 'navigate' | 'celebrate'

export interface ScriptedStep {
  type: ScriptedStepType
  // Selector for the element to highlight/interact with (empty = no spotlight)
  selector?: string
  title: string
  description: string
  // For 'type' steps — the value to auto-fill
  typeValue?: string
  // For 'type' steps that open a typeahead dropdown — the option the user must
  // click to advance (e.g. the "Mrs. Smith" result). The engine auto-fills the
  // input, then highlights this element and advances when the user clicks it.
  // Merges the old fill-then-pick two-step dance into one user-controlled step.
  advanceSelector?: string
  // For 'navigate' steps — the route to navigate to
  route?: string
  // For 'click' steps — whether to auto-advance after detecting the click
  autoAdvance?: boolean
  // Popover placement hint (engine picks best side if not specified)
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center'
}

export interface ScriptedTour {
  id: string
  title: string
  scenarioSummary: string // e.g. "Book Mrs. Smith for a Wash & Set tomorrow at 10am"
  platform: 'mobile' | 'desktop'
  role: string
  steps: ScriptedStep[]
  // What the user learned — shown in TutorialCelebration
  learnings: string[]
}

export interface ScriptedTourState {
  tourId: string
  stepIndex: number
  // Demo record IDs resolved at tour start
  scenarioState: Record<string, string>
  startedAt: number
}
