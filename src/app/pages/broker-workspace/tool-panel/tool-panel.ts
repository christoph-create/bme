import {
  ChangeDetectionStrategy,
  Component,
  input,
  signal,
} from "@angular/core";

import { ValueCharts } from "./value-charts/value-charts";

/** Tools that can occupy the panel. "pin" and "compare" are the planned
 * additions; each is a union member, a `tools` entry and a `@case`. */
export type WorkspaceTool = "charts";

interface ToolTab {
  readonly id: WorkspaceTool;
  readonly label: string;
}

/**
 * The workspace's right-hand dock, showing one tool at a time.
 *
 * A plain `@switch` on a signal rather than content projection or a DI
 * registry: projection would push the choice of active tool up into the
 * workspace, which has enough to own already, and a registry is a lot of
 * indirection for a list that is currently one item long. The switcher strip
 * appears on its own once there is a second tool to switch to.
 */
@Component({
  selector: "app-tool-panel",
  imports: [ValueCharts],
  templateUrl: "./tool-panel.html",
  styleUrl: "./tool-panel.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolPanel {
  readonly connectionId = input.required<string>();
  readonly selectedTopic = input<string | null>(null);
  /** Wide enough for two columns of charts. Decided by the workspace from the
   * dock's measured width, since it is the one that owns the grid. */
  readonly wide = input(false);
  /** The message stream's Pause, forwarded so the charts freeze with it. */
  readonly paused = input(false);

  readonly tools: readonly ToolTab[] = [{ id: "charts", label: "Charts" }];
  readonly activeTool = signal<WorkspaceTool>("charts");

  selectTool(id: WorkspaceTool): void {
    this.activeTool.set(id);
  }
}
