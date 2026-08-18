import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from "@angular/core";

/**
 * A drag handle between two panes.
 *
 * Reports a cumulative pixel delta from the start of the drag rather than a
 * size, because it has no idea what it is sizing - the owner folds that delta
 * into whatever geometry it keeps.
 *
 * Uses pointer capture rather than document-level move/up listeners, so the
 * drag follows the pointer outside the handle without the owner having to
 * host a shared drag state machine.
 */
@Component({
  selector: "app-splitter",
  template: "",
  styleUrl: "./splitter.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: "separator",
    tabindex: "-1",
    "[class.vertical]": "orientation() === 'vertical'",
    "[class.horizontal]": "orientation() === 'horizontal'",
    "[class.dragging]": "dragging()",
    "(pointerdown)": "onPointerDown($event)",
    "(pointermove)": "onPointerMove($event)",
    "(pointerup)": "onPointerUp($event)",
    "(pointercancel)": "onPointerUp($event)",
  },
})
export class Splitter {
  /** The handle's own orientation: a vertical bar resizes columns, a
   * horizontal one resizes rows. */
  readonly orientation = input.required<"vertical" | "horizontal">();

  readonly dragStarted = output<void>();
  /** Pixels moved along the handle's axis since `dragStarted`. */
  readonly dragged = output<number>();
  readonly dragEnded = output<void>();

  readonly dragging = signal(false);

  private origin = 0;

  onPointerDown(event: PointerEvent): void {
    // Otherwise the drag starts a text selection in whichever pane the
    // pointer crosses next.
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    this.origin = this.axisPosition(event);
    this.dragging.set(true);
    this.dragStarted.emit();
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.dragging()) {
      return;
    }
    this.dragged.emit(this.axisPosition(event) - this.origin);
  }

  onPointerUp(event: PointerEvent): void {
    if (!this.dragging()) {
      return;
    }
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    this.dragging.set(false);
    this.dragEnded.emit();
  }

  private axisPosition(event: PointerEvent): number {
    return this.orientation() === "vertical" ? event.clientX : event.clientY;
  }
}
