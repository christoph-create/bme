import { ChangeDetectionStrategy, Component, input } from "@angular/core";

import { LineDiff, visibleLine } from "./line-diff";

/**
 * The unified line diff - the fallback for payloads that are not JSON on both
 * sides.
 *
 * Hunk headers are shown rather than hidden: they are the only thing that
 * says the gap between two hunks is unchanged lines rather than the end of
 * the payload.
 */
@Component({
  selector: "app-line-diff-view",
  imports: [],
  templateUrl: "./line-diff-view.html",
  styleUrl: "./line-diff-view.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineDiffView {
  readonly diff = input.required<LineDiff>();

  /** Whitespace a line diff turns on has to be visible, or a CRLF change
   * reads as two identical lines marked as different. */
  text(line: string): string {
    return visibleLine(line);
  }

  marker(kind: LineDiff["hunks"][number]["rows"][number]["kind"]): string {
    if (kind === "added") {
      return "+";
    }
    return kind === "removed" ? "-" : " ";
  }
}
