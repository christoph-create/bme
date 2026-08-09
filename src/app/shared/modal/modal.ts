import { Component, DestroyRef, HostListener, inject, input, output } from "@angular/core";

/** Every currently-mounted modal, in the order they opened.
 *
 * Escape is a document-level listener, so without this each open modal would
 * react to the same keypress - and closing a variables editor opened from
 * inside the template form would take the half-finished template with it.
 * Only the last one opened responds. */
const openModals: Modal[] = [];

/** Generic modal shell (backdrop + panel + header), shared by every modal
 * dialog in the app - projects its body/footer content as-is. */
@Component({
  selector: "app-modal",
  imports: [],
  templateUrl: "./modal.html",
  styleUrl: "./modal.css",
})
export class Modal {
  readonly title = input.required<string>();
  readonly close_modal = output<void>();

  constructor() {
    openModals.push(this);
    inject(DestroyRef).onDestroy(() => {
      const index = openModals.indexOf(this);
      if (index !== -1) {
        openModals.splice(index, 1);
      }
    });
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    if (openModals[openModals.length - 1] === this) {
      this.close_modal.emit();
    }
  }

  onBackdropClick(): void {
    this.close_modal.emit();
  }
}
