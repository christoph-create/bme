/** What a keypress asks the interface size to do, if anything. */
export type ZoomAction = "in" | "out" | "reset";

/**
 * Maps a keypress to a zoom action, or `null` for everything else.
 *
 * The bindings every browser and editor uses, so they need no teaching:
 * Ctrl with `+` or `-` steps, Ctrl+0 goes back to 100%. Shift is allowed
 * because `+` *is* Shift+`=` on most layouts, and the numeric keypad reports
 * `+`/`-` directly.
 *
 * Alt is not: Ctrl+Alt+<key> is a different chord, and swallowing it would
 * shadow whatever the platform or a future shortcut does with it.
 */
export function zoomActionFor(event: KeyboardEvent): ZoomAction | null {
  // metaKey for a future macOS build, where Cmd is the modifier - harmless
  // on Linux and Windows, where nothing else claims it.
  if ((!event.ctrlKey && !event.metaKey) || event.altKey) {
    return null;
  }
  switch (event.key) {
    case "+":
    case "=":
      return "in";
    case "-":
    case "_":
      return "out";
    case "0":
      return "reset";
    default:
      return null;
  }
}
