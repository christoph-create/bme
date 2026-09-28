import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from "@angular/core";

import { computeChartGeometry } from "../value-charts/chart-geometry";

/** Small enough to sit under a value without becoming a chart in its own
 * right - it says "rising" or "flat", not "23.4 at 14:02". */
const SPARK_WIDTH = 120;
const SPARK_HEIGHT = 26;

/**
 * One reading on the broker panel: a label, a value, and optionally a shape
 * for how it got there.
 *
 * Presentational only - it formats nothing and reads nothing. Whoever renders
 * it has already been through `format-stat.ts`, which keeps every number on
 * the panel rounding the same way.
 */
@Component({
  selector: "app-stat-tile",
  templateUrl: "./stat-tile.html",
  styleUrl: "./stat-tile.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatTile {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  /** The small print under the value - a unit's caveat, typically. */
  readonly hint = input<string | null>(null);
  /** Evenly-spaced readings, oldest first. Two or more draw a line. */
  readonly series = input<readonly number[]>([]);
  /** Dims the tile without removing it, for a reading that is real but
   * stopped - an uptime with no link behind it any more. */
  readonly stale = input(false);

  readonly viewWidth = SPARK_WIDTH;
  readonly viewHeight = SPARK_HEIGHT;

  readonly geometry = computed(() => {
    const series = this.series();
    // `computeChartGeometry` wants (time, value) pairs; a sparkline's samples
    // are evenly spaced by construction, so the index is the clock. Its axis
    // ticks are computed and then ignored - a handful of array operations,
    // and much cheaper than a second geometry implementation to keep in step
    // with this one.
    return computeChartGeometry(
      series.map((v, t) => ({ t, v })),
      { width: SPARK_WIDTH, height: SPARK_HEIGHT },
    );
  });

  readonly hasShape = computed(() => this.geometry().polyline !== "");
}
