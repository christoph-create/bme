import { Component, input, output } from "@angular/core";

import { Modal } from "../modal/modal";

/** Confirmation for a destructive action, on the shared modal shell.
 * Cancelling and dismissing are the same outcome, so backdrop clicks, the
 * close button and Escape all resolve to `cancelled` - nothing here is
 * destructive except the one button that says so. */
@Component({
  selector: "app-confirm-dialog",
  imports: [Modal],
  templateUrl: "./confirm-dialog.html",
  styleUrl: "./confirm-dialog.css",
})
export class ConfirmDialog {
  readonly title = input.required<string>();
  readonly message = input.required<string>();
  readonly detail = input<string | null>(null);
  readonly confirmLabel = input<string>("Delete");

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();
}
