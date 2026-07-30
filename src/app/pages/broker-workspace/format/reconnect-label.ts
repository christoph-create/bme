/**
 * The text next to the reconnect spinner. Showing the attempt against the
 * budget is the whole point: it turns "something is happening" into "this will
 * stop trying at ten", so the wait is bounded and legible rather than an
 * indefinite spinner.
 */
export function reconnectLabel(attempt: number, maxAttempts: number): string {
  if (maxAttempts <= 1) {
    return "Reconnecting…";
  }
  const shown = Math.min(attempt, maxAttempts);
  return `Reconnecting… (attempt ${shown} of ${maxAttempts})`;
}
