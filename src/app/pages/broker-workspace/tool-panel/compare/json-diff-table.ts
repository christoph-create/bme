import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from "@angular/core";

import { JsonDiffKind, JsonDiffRow } from "./json-diff";

const MARKERS: Record<JsonDiffKind, string> = {
  changed: "~",
  added: "+",
  removed: "-",
  unchanged: " ",
};

/** What a screen reader hears in place of the marker glyph. */
const KIND_WORDS: Record<JsonDiffKind, string> = {
  changed: "changed",
  added: "added",
  removed: "removed",
  unchanged: "unchanged",
};

/**
 * The structural diff of two JSON payloads, one row per field path.
 *
 * The unchanged rows are collapsed behind a count, and that collapse is local
 * state rather than the parent's: nothing outside this table cares whether
 * the user has expanded it.
 */
@Component({
  selector: "app-json-diff-table",
  imports: [],
  templateUrl: "./json-diff-table.html",
  styleUrl: "./json-diff-table.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JsonDiffTable {
  /** Already grouped by `groupDiffRows`, so changed rows come first. */
  readonly rows = input.required<readonly JsonDiffRow[]>();
  /** Splits each row into path / before / after columns. Below the dock's
   * wide threshold the values stack under the path instead - at the 240px
   * floor three columns simply do not fit. */
  readonly wide = input(false);

  readonly unchangedExpanded = signal(false);

  readonly changedRows = computed(() =>
    this.rows().filter((row) => row.kind !== "unchanged"),
  );
  readonly unchangedRows = computed(() =>
    this.rows().filter((row) => row.kind === "unchanged"),
  );

  readonly unchangedLabel = computed(() => {
    const count = this.unchangedRows().length;
    const noun = count === 1 ? "field" : "fields";
    return this.unchangedExpanded()
      ? `Hide ${count} unchanged ${noun}`
      : `${count} unchanged ${noun}`;
  });

  marker(kind: JsonDiffKind): string {
    return MARKERS[kind];
  }

  kindWord(kind: JsonDiffKind): string {
    return KIND_WORDS[kind];
  }

  toggleUnchanged(): void {
    this.unchangedExpanded.update((open) => !open);
  }
}
