import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from "@angular/core";

/** Which edge of the workspace the dock this button controls sits on. */
export type DockSide = "left" | "bottom" | "right";

interface Strip {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const STRIPS: Record<DockSide, Strip> = {
  left: { x: 1, y: 1, width: 4, height: 12 },
  bottom: { x: 1, y: 9, width: 12, height: 4 },
  right: { x: 9, y: 1, width: 4, height: 12 },
};

/**
 * Shows and hides one of the workspace's docks.
 *
 * The icon is a miniature of the workspace itself - a box with the dock's own
 * edge filled in - so the three buttons read as a map rather than as three
 * labels you have to learn.
 */
@Component({
  selector: "app-dock-toggle",
  templateUrl: "./dock-toggle.html",
  styleUrl: "./dock-toggle.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DockToggle {
  readonly side = input.required<DockSide>();
  /** The dock's name, as the button announces it. */
  readonly label = input.required<string>();
  readonly active = input(false);
  readonly toggled = output<void>();

  readonly strip = computed(() => STRIPS[this.side()]);
  readonly title = computed(
    () => `${this.active() ? "Hide" : "Show"} ${this.label()}`,
  );
}
