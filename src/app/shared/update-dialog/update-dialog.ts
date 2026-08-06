import { Component, computed, input, output } from "@angular/core";

import { AvailableRelease } from "../../core/models/update-check.model";
import { Modal } from "../modal/modal";
import { releaseNotesText } from "./release-notes-text";

/**
 * Offers a newer release, on the shared modal shell. Presentational only -
 * every action is an output, so the same dialog serves the automatic check and
 * the manual one.
 *
 * Dismissing and skipping are deliberately different outcomes, and only the
 * button that says "Skip this version" skips: Escape, the backdrop and the
 * close button all dismiss, so the harmless outcome is the one you get by
 * accident. Same principle as ConfirmDialog.
 */
@Component({
  selector: "app-update-dialog",
  imports: [Modal],
  templateUrl: "./update-dialog.html",
  styleUrl: "./update-dialog.css",
})
export class UpdateDialog {
  readonly release = input.required<AvailableRelease>();
  readonly currentVersion = input.required<string>();

  readonly opened = output<void>();
  readonly dismissed = output<void>();
  readonly skipped = output<void>();

  readonly notesText = computed(() => releaseNotesText(this.release().notes));
}
