import type { IncidentEvent } from './incidents.service';
let sink: ((event: IncidentEvent) => void) | undefined;
export function registerIncidentSink(
  callback: ((event: IncidentEvent) => void) | undefined,
) {
  sink = callback;
}
/** Non-throwing, no dependency cycle, and no incident-about-incident recursion. */
export function captureIncident(event: IncidentEvent) {
  try {
    sink?.(event);
  } catch {
    /* Diagnostics never replace the original failure. */
  }
}
