/**
 * Keyboard navigation for the tool dock's tab strip.
 *
 * Its own module because wrap-around is the part of a tab strip that gets
 * quietly wrong, and because the strip is about to hold more than the two
 * tools it has today - getting it right once is cheaper than getting it
 * right per tool.
 */

/** The step a key press asks for, as a signed number of tabs. */
export type ToolStep = -1 | 1 | "first" | "last";

/** The key presses a tab strip is expected to answer, per the WAI-ARIA tabs
 * pattern. Anything else returns null so the caller can leave the event
 * alone - swallowing keys a strip has no opinion about breaks Tab. */
export function stepForKey(key: string): ToolStep | null {
  switch (key) {
    case "ArrowLeft":
    case "ArrowUp":
      return -1;
    case "ArrowRight":
    case "ArrowDown":
      return 1;
    case "Home":
      return "first";
    case "End":
      return "last";
    default:
      return null;
  }
}

/**
 * The tool a step lands on, wrapping at both ends.
 *
 * A tool the list doesn't contain resolves to the first one rather than
 * throwing: the only way to get here is a stale id, and starting over beats
 * leaving the strip with nothing selected.
 */
export function nextTool<T>(
  tools: readonly T[],
  current: T,
  step: ToolStep,
): T {
  if (tools.length === 0) {
    return current;
  }
  if (step === "first") {
    return tools[0];
  }
  if (step === "last") {
    return tools[tools.length - 1];
  }

  const index = tools.indexOf(current);
  if (index === -1) {
    return tools[0];
  }
  // `+ length` before the modulo, because JavaScript's `%` keeps the sign of
  // the left operand and -1 % 3 is -1, not 2.
  return tools[(index + step + tools.length) % tools.length];
}
