/**
 * Presentation helpers for `setup-progress` events.
 *
 * Progress events carry two things: a coarse `step` (which phase of the
 * connect/bootstrap flow we are in) and a granular `label` (the action running
 * right now). The UI shows the phase as a headline and the label underneath, so
 * the label must never restate the headline.
 */

/** Headline for a phase. `null` means "the step carries no phase of its own — keep the current headline". */
export function setupPhaseHeadline(step: string): string | null {
  switch (step) {
    case 'probe':
      return 'Checking the server…'
    case 'auth':
      return 'Authenticating…'
    case 'key':
      return 'Setting up SSH key access…'
    case 'bootstrap':
    case 'bootstrap-log':
      return 'Installing server software… This may take several minutes.'
    case 'packages':
      return 'Installing 45Drives packages…'
    case 'done':
      return 'Finishing up…'
    default:
      return null
  }
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * True when the detail line adds nothing over the headline — either identical
 * wording or a subset of it.
 */
export function isRedundantDetail(detail: string, headline: string): boolean {
  const d = normalize(detail)
  if (!d) return true
  const h = normalize(headline)
  if (!h) return false
  return h === d || h.includes(d)
}
