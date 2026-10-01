/** A path step that can be written after a dot without ambiguity. */
const BARE_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
/** A whole-number step, which reads as an array index. */
const INDEX = /^(?:0|[1-9]\d*)$/;

/**
 * A path as the field table labels it, in the JSON-path idiom.
 *
 * Bracket-quoting anything that is not a bare identifier is what keeps
 * `{"a.b": 1}` (-> `["a.b"]`) from reading identically to `{"a": {"b": 1}}`
 * (-> `a.b`). Comparing paths step by step keeps them *distinct* - see
 * `ValueChartsService.samePath` - and this is what makes them
 * distinguishable on screen too, which a diff needs and a chart picker did
 * not.
 *
 * A whole-number step renders as an index, so an object key that happens to
 * be `"0"` reads the same as array position 0. The path representation
 * genuinely cannot tell those apart, and inventing a distinction here would
 * only hide that.
 *
 *   []                  -> "(root)"
 *   ["battery","level"] -> "battery.level"
 *   ["items","0","id"]  -> "items[0].id"
 *   ["a.b"]             -> '["a.b"]'
 *   [""]                -> '[""]'
 *   ["2fa"]             -> '["2fa"]'
 */
export function formatPath(path: readonly string[]): string {
  if (path.length === 0) {
    return "(root)";
  }

  let label = "";
  for (const step of path) {
    if (INDEX.test(step)) {
      label += `[${step}]`;
    } else if (BARE_IDENTIFIER.test(step)) {
      label += label === "" ? step : `.${step}`;
    } else {
      label += `[${JSON.stringify(step)}]`;
    }
  }
  return label;
}
