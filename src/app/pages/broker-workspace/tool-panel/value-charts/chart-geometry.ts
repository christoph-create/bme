import { formatAxisValue, formatClockTime } from "./axis-format";
import { niceTicks } from "./axis-ticks";
import { Sample } from "./sample-series";

/**
 * The plot is drawn in these fixed units and stretched horizontally by CSS
 * (`preserveAspectRatio="none"`), so dragging the panel splitter costs no
 * JavaScript at all - no measuring, no recomputing geometry per frame.
 *
 * The card renders the SVG at exactly `CHART_VIEW_HEIGHT` CSS pixels tall, so
 * vertical scale stays 1:1 and a `y` here is a `y` in pixels. That is what
 * lets the value labels be plain positioned HTML rather than SVG text, which
 * the horizontal stretch would otherwise distort.
 */
export const CHART_VIEW_WIDTH = 600;
export const CHART_VIEW_HEIGHT = 160;

const VALUE_TICK_TARGET = 4;
const TIME_TICK_COUNT = 3;
/** Padding applied to a flat series, as a fraction of the value itself. */
const FLAT_SERIES_PAD_RATIO = 0.1;
/** Padding for a flat series sitting exactly on zero, where a ratio gives 0. */
const FLAT_SERIES_PAD_ABSOLUTE = 1;

export interface PlotPoint {
  readonly x: number;
  readonly y: number;
}

export interface AxisTick {
  /** Position in viewBox units - `y` for value ticks, `x` for time ticks. */
  readonly position: number;
  readonly label: string;
}

export interface ValueDomain {
  readonly min: number;
  readonly max: number;
}

export interface ChartGeometry {
  readonly points: readonly PlotPoint[];
  /** `points` as an SVG `points` attribute; empty below two points. */
  readonly polyline: string;
  /** Closed path from the line down to the baseline, for the tint fill. */
  readonly area: string;
  readonly valueTicks: readonly AxisTick[];
  readonly timeTicks: readonly AxisTick[];
  readonly valueDomain: ValueDomain;
  readonly timeSpanMs: number;
}

const EMPTY_GEOMETRY: ChartGeometry = {
  points: [],
  polyline: "",
  area: "",
  valueTicks: [],
  timeTicks: [],
  valueDomain: { min: 0, max: 1 },
  timeSpanMs: 0,
};

/**
 * Projects `samples` (oldest first) onto a `size`-sized plot: oldest at
 * `x = 0`, newest at `x = width`, and the largest value at `y = 0` - SVG's y
 * axis points down, so the series is inverted on the way through.
 */
export function computeChartGeometry(
  samples: readonly Sample[],
  size: { readonly width: number; readonly height: number },
): ChartGeometry {
  if (samples.length === 0) {
    return EMPTY_GEOMETRY;
  }

  const { width, height } = size;
  const domain = valueDomainOf(samples);
  const firstTime = samples[0].t;
  const timeSpanMs = samples[samples.length - 1].t - firstTime;

  const toY = (value: number): number =>
    height - ((value - domain.min) / (domain.max - domain.min)) * height;

  // A single sample has no span to spread across, so it sits centred rather
  // than pinned to an edge where its marker would be half outside the plot.
  if (samples.length === 1) {
    return {
      points: [{ x: width / 2, y: height / 2 }],
      polyline: "",
      area: "",
      valueTicks: buildValueTicks(domain, height, toY),
      timeTicks: [{ position: width / 2, label: formatClockTime(firstTime, 0) }],
      valueDomain: domain,
      timeSpanMs: 0,
    };
  }

  const lastIndex = samples.length - 1;
  const points = samples.map((sample, index) => ({
    // Several messages can share a millisecond during a burst, which would
    // make every x identical. Ordering is known even when timing isn't, so a
    // zero span falls back to spacing the samples evenly by index.
    x:
      timeSpanMs === 0
        ? (index / lastIndex) * width
        : ((sample.t - firstTime) / timeSpanMs) * width,
    y: toY(sample.v),
  }));

  const polyline = points.map((p) => `${round(p.x)},${round(p.y)}`).join(" ");
  const area =
    `M ${round(points[0].x)} ${height} ` +
    points.map((p) => `L ${round(p.x)} ${round(p.y)}`).join(" ") +
    ` L ${round(points[lastIndex].x)} ${height} Z`;

  return {
    points,
    polyline,
    area,
    valueTicks: buildValueTicks(domain, height, toY),
    timeTicks: buildTimeTicks(firstTime, timeSpanMs, width),
    valueDomain: domain,
    timeSpanMs,
  };
}

function valueDomainOf(samples: readonly Sample[]): ValueDomain {
  let min = samples[0].v;
  let max = samples[0].v;
  for (const sample of samples) {
    min = Math.min(min, sample.v);
    max = Math.max(max, sample.v);
  }

  if (min !== max) {
    return { min, max };
  }

  // A flat series still needs a range to divide by. Padding proportionally
  // keeps a steady 0.002 readable, which a fixed +/-1 would flatten to
  // nothing; the absolute fallback covers a value of exactly zero.
  const pad =
    Math.abs(min) > 0
      ? Math.abs(min) * FLAT_SERIES_PAD_RATIO
      : FLAT_SERIES_PAD_ABSOLUTE;
  return { min: min - pad, max: max + pad };
}

function buildValueTicks(
  domain: ValueDomain,
  height: number,
  toY: (value: number) => number,
): readonly AxisTick[] {
  const { step, values } = niceTicks(domain.min, domain.max, VALUE_TICK_TARGET);
  return values
    .filter((value) => value >= domain.min && value <= domain.max)
    .map((value) => ({
      position: clamp(toY(value), 0, height),
      label: formatAxisValue(value, step),
    }));
}

function buildTimeTicks(
  firstTime: number,
  timeSpanMs: number,
  width: number,
): readonly AxisTick[] {
  return Array.from({ length: TIME_TICK_COUNT }, (_, index) => {
    const fraction = index / (TIME_TICK_COUNT - 1);
    return {
      position: fraction * width,
      label: formatClockTime(firstTime + fraction * timeSpanMs, timeSpanMs),
    };
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Two decimals is well under a device pixel at any panel width, and keeps
 * the `points` attribute from tripling in length. */
function round(value: number): number {
  return Number(value.toFixed(2));
}
