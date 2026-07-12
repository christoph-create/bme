import { Component, model } from "@angular/core";

import { QoS, qosNumber } from "../../../core/models/qos";

const QOS_OPTIONS: readonly QoS[] = ["AtMostOnce", "AtLeastOnce", "ExactlyOnce"];

/** Segmented Q0/Q1/Q2 toggle, shared by the subscribe and publish forms. */
@Component({
  selector: "app-qos-select",
  imports: [],
  templateUrl: "./qos-select.html",
  styleUrl: "./qos-select.css",
})
export class QosSelect {
  readonly qosOptions = QOS_OPTIONS;
  readonly qosNumber = qosNumber;

  readonly value = model<QoS>("AtMostOnce");

  select(qos: QoS): void {
    this.value.set(qos);
  }
}
