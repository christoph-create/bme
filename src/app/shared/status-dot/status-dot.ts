import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";

import {
  ConnectionStatus,
  StatusTone,
  statusTone,
} from "../../core/status/connection-status";

const LABELS: Record<StatusTone, string> = {
  connected: "Connected",
  pending: "Connecting",
  error: "Connection failed",
  idle: "Not connected",
};

/** A broker's connection state, small enough to sit beside its name. */
@Component({
  selector: "app-status-dot",
  template: "",
  styleUrl: "./status-dot.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    "[class]": "tone()",
    role: "img",
    "[attr.aria-label]": "label()",
    "[title]": "label()",
  },
})
export class StatusDot {
  readonly status = input.required<ConnectionStatus>();

  readonly tone = computed(() => statusTone(this.status()));
  readonly label = computed(() => LABELS[this.tone()]);
}
