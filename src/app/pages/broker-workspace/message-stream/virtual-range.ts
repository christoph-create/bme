export interface VisibleRange {
  readonly startIndex: number;
  readonly endIndex: number;
}

/**
 * Cumulative top offset of each item in a vertical stack of `heights.length`
 * items separated by `gap` pixels. `offsets[i]` is where item `i` starts;
 * `offsets[heights.length]` is the total stack height (no trailing gap
 * after the last item).
 */
export function computeOffsets(
  heights: readonly number[],
  gap: number,
): readonly number[] {
  const offsets: number[] = [];
  let top = 0;
  for (let i = 0; i < heights.length; i++) {
    if (i > 0) {
      top += gap;
    }
    offsets.push(top);
    top += heights[i];
  }
  offsets.push(top);
  return offsets;
}

/**
 * Which item indices (from an `offsets` array as returned by
 * `computeOffsets`) overlap the viewport `[scrollTop, scrollTop +
 * viewportHeight)`, expanded by `buffer` items on each side and clamped to
 * the array bounds.
 */
export function computeVisibleRange(
  offsets: readonly number[],
  scrollTop: number,
  viewportHeight: number,
  buffer: number,
): VisibleRange {
  const itemCount = offsets.length - 1;
  if (itemCount <= 0) {
    return { startIndex: 0, endIndex: 0 };
  }

  const firstVisible = Math.max(0, upperBound(offsets, scrollTop) - 1);
  const lastVisible = upperBound(offsets, scrollTop + viewportHeight);

  return {
    startIndex: Math.max(0, firstVisible - buffer),
    endIndex: Math.min(itemCount, lastVisible + buffer),
  };
}

/** First index in `offsets` whose value is strictly greater than `target`. */
function upperBound(offsets: readonly number[], target: number): number {
  let lo = 0;
  let hi = offsets.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (offsets[mid] <= target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}
