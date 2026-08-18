/**
 * The workspace's three docks and the geometry that arranges them.
 *
 * Kept as plain functions over a plain `LayoutInput` so the sizing rules can
 * be tested without a component, a window or a grid.
 */

/** Subscriptions on the left, Publish across the bottom of the centre column,
 * Tools/Charts on the right. The centre column - topic stream above, publish
 * below - is not a dock: it is what the docks are arranged around, and it can
 * never be hidden. */
export type DockId = "subscriptions" | "publish" | "tools";

interface DockLimits {
  readonly min: number;
  readonly max: number;
  readonly default: number;
}

export const DOCK_LIMITS: Record<DockId, DockLimits> = {
  subscriptions: { min: 200, max: 1200, default: 260 },
  publish: { min: 200, max: 800, default: 260 },
  tools: { min: 240, max: 1600, default: 360 },
};

/** Width of every splitter track, and so the width of the drag target. */
export const SPLITTER_PX = 6;

/** How little the centre column may be squeezed to before the side docks stop
 * growing. Without it, a wide sidebar plus a wide tool panel can leave the
 * stream at zero with no way to drag it back. */
export const MIN_CENTRE_WIDTH = 400;

/** Below this the charts stay in one column - two columns of cards this narrow
 * are less readable than one. */
export const WIDE_TOOLS_WIDTH = 600;

export type DockFractions = Record<DockId, number>;

export interface LayoutInput {
  readonly windowWidth: number;
  readonly windowHeight: number;
  readonly fractions: DockFractions;
  readonly open: Record<DockId, boolean>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Sizes are stored as a fraction of the window's current dimensions rather
 * than as pixels that get nudged around on every resize event, so recomputing
 * one after a window resize is a pure `fraction * windowSize` read - never an
 * incremental adjustment that could drift or compound.
 */
export function defaultFractions(
  windowWidth: number,
  windowHeight: number,
): DockFractions {
  return {
    subscriptions: DOCK_LIMITS.subscriptions.default / windowWidth,
    publish: DOCK_LIMITS.publish.default / windowHeight,
    tools: DOCK_LIMITS.tools.default / windowWidth,
  };
}

/**
 * The pixel size of every dock, whether or not it is currently open - a closed
 * dock keeps its size so that reopening restores the width the user last
 * dragged to.
 */
export function dockSizesPx(input: LayoutInput): Record<DockId, number> {
  const subscriptions = clamp(
    input.fractions.subscriptions * input.windowWidth,
    DOCK_LIMITS.subscriptions.min,
    DOCK_LIMITS.subscriptions.max,
  );

  // The tools dock competes with the subscriptions dock for the same row, so
  // widening the sidebar squeezes it rather than the centre column. A hidden
  // sidebar is not competing for anything.
  const available =
    input.windowWidth -
    (input.open.subscriptions ? subscriptions : 0) -
    MIN_CENTRE_WIDTH;

  return {
    subscriptions,
    publish: clamp(
      input.fractions.publish * input.windowHeight,
      DOCK_LIMITS.publish.min,
      DOCK_LIMITS.publish.max,
    ),
    tools: clamp(
      input.fractions.tools * input.windowWidth,
      DOCK_LIMITS.tools.min,
      Math.max(
        DOCK_LIMITS.tools.min,
        Math.min(DOCK_LIMITS.tools.max, available),
      ),
    ),
  };
}

/**
 * Five tracks in every state: sidebar, its splitter, the centre column, the
 * tools splitter, tools. A hidden dock keeps zero-width tracks rather than
 * losing them, which is both what lets the centre column's own rows stay
 * anchored to track 3 unconditionally and what makes the open/close
 * transition interpolable.
 */
export function gridColumns(input: LayoutInput): string {
  const sizes = dockSizesPx(input);
  const left = input.open.subscriptions
    ? `${sizes.subscriptions}px ${SPLITTER_PX}px`
    : "0 0";
  const right = input.open.tools
    ? `${SPLITTER_PX}px ${sizes.tools}px`
    : "0 0";
  return `${left} 1fr ${right}`;
}

/** Rows of the centre column: stream, splitter, publish. */
export function gridRows(input: LayoutInput): string {
  const sizes = dockSizesPx(input);
  return input.open.publish
    ? `1fr ${SPLITTER_PX}px ${sizes.publish}px`
    : "1fr 0 0";
}

/**
 * Folds a splitter drag back into the stored fractions.
 *
 * `deltaPx` is cumulative from the start of the drag and `startSizePx` is the
 * dock's size at that moment, so a drag is always resolved against where it
 * began - dragging out past a clamp and back again lands where it started.
 */
export function applyDrag(
  input: LayoutInput,
  dock: DockId,
  deltaPx: number,
  startSizePx: number,
): DockFractions {
  // Only the subscriptions handle sits on its dock's trailing edge. For the
  // other two the handle is on the leading edge, so dragging towards the dock
  // shrinks it.
  const dragged =
    dock === "subscriptions" ? startSizePx + deltaPx : startSizePx - deltaPx;
  const size = clamp(dragged, DOCK_LIMITS[dock].min, DOCK_LIMITS[dock].max);
  const basis = dock === "publish" ? input.windowHeight : input.windowWidth;

  return { ...input.fractions, [dock]: size / basis };
}

export function toolsIsWide(widthPx: number): boolean {
  return widthPx >= WIDE_TOOLS_WIDTH;
}
