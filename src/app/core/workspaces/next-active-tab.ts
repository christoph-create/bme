/**
 * Which tab to activate once `closedId` is gone.
 *
 * Prefers the tab to its right, falling back to the one on its left - the same
 * rule browsers use, and the one that keeps closing several tabs in a row from
 * jumping around. Returns null when nothing is left to show.
 *
 * Closing a tab that wasn't the active one leaves the active one alone.
 */
export function nextActiveId(
  openIds: readonly string[],
  closedId: string,
  activeId: string | null,
): string | null {
  const index = openIds.indexOf(closedId);
  if (index === -1 || closedId !== activeId) {
    return activeId;
  }
  return openIds[index + 1] ?? openIds[index - 1] ?? null;
}
