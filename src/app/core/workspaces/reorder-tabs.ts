/**
 * Where a dragged tab belongs, and how far it has to be shifted to stay under
 * the pointer on the way there.
 *
 * Kept out of the tab bar so the arithmetic can be tested without a pointer:
 * the component's only job is to measure the strip and hand over the numbers.
 */

/**
 * How far the pointer must travel before a press counts as a drag rather than
 * a click, in pixels - enough to survive the wobble of an ordinary click.
 */
export const DRAG_THRESHOLD_PX = 4;

/** A tab's place in the strip, as laid out - before any drag shift. */
export interface Slot {
  readonly left: number;
  readonly width: number;
}

/**
 * The index the tab at `fromIndex` should move to, given where every tab's
 * slot is and where the pointer has carried the dragged tab's centre.
 *
 * A tab passes a neighbour once its *leading* edge - left when it is heading
 * left, right when it is heading right - is past that neighbour's middle.
 * Comparing the two centres instead would be simpler and is wrong: broker
 * names make tabs of different widths, and a wide tab can be carried right up
 * against the end of the strip without its centre ever reaching the centre of
 * the narrow tab beside it, leaving that swap impossible to perform. Edges
 * have no such dead zone - a tab flush against the end of the run is always
 * past everything between it and that end.
 *
 * Counting rather than scanning also means a pointer that jumps several tabs
 * in one move lands in the right slot, not just one place along.
 */
export function dropIndexFor(
  slots: readonly Slot[],
  draggedCenter: number,
  fromIndex: number,
): number {
  const half = slots[fromIndex].width / 2;
  const centers = slots.map((slot) => slot.left + slot.width / 2);
  const leadingEdge =
    draggedCenter < centers[fromIndex]
      ? draggedCenter - half
      : draggedCenter + half;

  return centers.filter(
    (center, index) => index !== fromIndex && center < leadingEdge,
  ).length;
}

/**
 * `ids` with the entry at `from` moved to `to`.
 *
 * Returns the array untouched when the move would change nothing or either
 * index is out of range, so a caller holding it in a signal can assign the
 * result unconditionally without waking anything up.
 */
export function moveTab<T>(
  ids: readonly T[],
  from: number,
  to: number,
): readonly T[] {
  if (from === to || !inRange(ids, from) || !inRange(ids, to)) {
    return ids;
  }
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function inRange(ids: readonly unknown[], index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < ids.length;
}

export interface DragLayout {
  /** Where in the open-tab list the dragged tab now belongs. */
  readonly toIndex: number;
  /**
   * Pixels to shift the dragged tab by, from the slot it now occupies.
   *
   * Its slot changes in whole tabs while the pointer moves in pixels; this is
   * the difference, and it is what keeps the tab under the pointer instead of
   * snapping from slot to slot.
   */
  readonly offset: number;
}

/**
 * Both halves of a drag: the slot the tab is being carried into, and how far
 * it sits from that slot right now.
 *
 * `draggedCenter` is where the pointer wants the tab's middle to be, and gets
 * clamped to the run of tabs first - a tab has nowhere to go outside it, and
 * letting one hang over the home button or the gear would suggest it could be
 * dropped there.
 */
export function dragLayout(
  slots: readonly Slot[],
  draggedCenter: number,
  fromIndex: number,
): DragLayout {
  if (!inRange(slots, fromIndex)) {
    return { toIndex: fromIndex, offset: 0 };
  }
  const width = slots[fromIndex].width;
  const first = slots[0];
  const last = slots[slots.length - 1];
  const center = clamp(
    draggedCenter,
    first.left + width / 2,
    last.left + last.width - width / 2,
  );

  const toIndex = dropIndexFor(slots, center, fromIndex);
  // The strip is a contiguous row, so the slot the tab lands in starts after
  // everything that ends up before it - which is the widths, reordered.
  const widths = moveTab(
    slots.map((slot) => slot.width),
    fromIndex,
    toIndex,
  );
  const left = widths
    .slice(0, toIndex)
    .reduce((sum, each) => sum + each, first.left);

  return { toIndex, offset: center - (left + width / 2) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
