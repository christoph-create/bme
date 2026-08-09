export interface TickScale {
  /** The chosen spacing. Callers need it to pick how many decimals to print. */
  readonly step: number;
  readonly values: readonly number[];
}

/**
 * Round values - 1, 2 or 5 times a power of ten - covering `[min, max]`,
 * aiming for roughly `targetCount` of them.
 *
 * A degenerate range (empty, or either bound not finite) yields the single
 * value `min` and a step of 0, which callers read as "no meaningful scale".
 */
export function niceTicks(
  min: number,
  max: number,
  targetCount: number,
): TickScale {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const count = Math.max(2, Math.floor(targetCount));

  const span = hi - lo;
  if (!Number.isFinite(span) || span <= 0) {
    return { step: 0, values: [lo] };
  }

  const step = niceStep(span / count);
  const decimals = decimalsForStep(step);
  const firstIndex = Math.ceil(lo / step);
  const lastIndex = Math.floor(hi / step);

  const values: number[] = [];
  for (let i = firstIndex; i <= lastIndex; i++) {
    // Rounded to the step's own precision because neither repeated addition
    // nor multiplication is exact: 3 * 0.1 is 0.30000000000000004, and an
    // axis labelled with that is the classic tell of a hand-rolled chart.
    values.push(roundTo(i * step, decimals));
  }
  return { step, values };
}

/**
 * How many decimal places a value on a `step`-spaced axis needs. Since `step`
 * is always 1, 2 or 5 times a power of ten, its magnitude alone says this.
 */
export function decimalsForStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) {
    return 0;
  }
  return Math.max(0, -Math.floor(Math.log10(step)));
}

/** The 1/2/5-times-a-power-of-ten value closest in magnitude to `rough`. */
function niceStep(rough: number): number {
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / magnitude;
  const factor =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

function roundTo(value: number, decimals: number): number {
  // toFixed rather than a multiply/round/divide, which reintroduces exactly
  // the error being corrected for.
  return Number(value.toFixed(Math.min(decimals, 20)));
}
