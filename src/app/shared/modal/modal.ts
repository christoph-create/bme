import { Component, HostListener, input, output } from "@angular/core";

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

  @HostListener("document:keydown.escape")
  onEscape(): void {
    this.close_modal.emit();
  }

  onBackdropClick(): void {
    this.close_modal.emit();
  }
}
