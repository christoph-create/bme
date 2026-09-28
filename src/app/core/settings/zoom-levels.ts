/**
 * The interface-size steps, as webview zoom factors.
 *
 * A single zoom lever rather than a font-size setting on purpose: the
 * workspace's geometry lives in JavaScript as well as CSS - `DOCK_LIMITS`
 * and `SPLITTER_PX` in `layout/dock-layout.ts`, the virtualised stream's row
 * heights - so scaling text alone would leave the docks, splitters and
 * measured rows behind. Webview zoom scales the CSS pixel itself, which
 * means every one of those numbers keeps its meaning and the whole interface
 * grows together.
 */
export const ZOOM_LEVELS: readonly number[] = [
  0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2,
];

export const DEFAULT_ZOOM = 1;

/** Pulls any number onto the nearest step. Everything that can set the zoom -
 * the select, the keyboard shortcuts, a hand-edited database row - goes
 * through this, so the stored value is always one the UI can show as
 * selected. */
export function snapZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_ZOOM;
  }
  return ZOOM_LEVELS.reduce((best, level) =>
    Math.abs(level - value) < Math.abs(best - value) ? level : best,
  );
}

/** The next step up, or the current one if already at the top. */
export function zoomIn(current: number): number {
  const index = ZOOM_LEVELS.indexOf(snapZoom(current));
  return ZOOM_LEVELS[Math.min(index + 1, ZOOM_LEVELS.length - 1)];
}

/** The next step down, or the current one if already at the bottom. */
export function zoomOut(current: number): number {
  const index = ZOOM_LEVELS.indexOf(snapZoom(current));
  return ZOOM_LEVELS[Math.max(index - 1, 0)];
}

/** "125%" - how a zoom factor is labelled everywhere in the UI. */
export function formatZoomPercent(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}
