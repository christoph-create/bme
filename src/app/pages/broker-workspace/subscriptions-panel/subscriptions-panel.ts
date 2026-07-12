import { Component, OnInit, inject, input, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";

import { Subscription } from "../../../core/models/broker-connection.model";
import { QoS, qosNumber } from "../../../core/models/qos";
import { ConnectionsService } from "../../../core/services/connections.service";
import { MqttService } from "../../../core/services/mqtt.service";
import { QosSelect } from "../qos-select/qos-select";

@Component({
  selector: "app-subscriptions-panel",
  imports: [ReactiveFormsModule, QosSelect],
  templateUrl: "./subscriptions-panel.html",
  styleUrl: "./subscriptions-panel.css",
})
export class SubscriptionsPanel implements OnInit {
  readonly qosNumber = qosNumber;
  readonly connectionId = input.required<string>();

  private readonly connectionsService = inject(ConnectionsService);
  private readonly mqttService = inject(MqttService);
  private readonly formBuilder = inject(FormBuilder);

  readonly subscriptions = signal<Subscription[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly adding = signal(false);
  readonly qos = signal<QoS>("AtMostOnce");

  readonly form = this.formBuilder.nonNullable.group({
    topic: ["", Validators.required],
  });

  ngOnInit(): void {
    void this.refresh();
  }

  toggleAdd(): void {
    this.adding.set(!this.adding());
  }

  async subscribe(): Promise<void> {
    if (this.form.invalid) {
      return;
    }
    const topic = this.form.controls.topic.value;
    const subscription = await this.mqttService.subscribe(
      this.connectionId(),
      topic,
      this.qos(),
    );
    this.subscriptions.update((subs) => [...subs, subscription]);
    this.form.reset();
    this.qos.set("AtMostOnce");
    this.adding.set(false);
  }

  async unsubscribe(subscription: Subscription): Promise<void> {
    await this.mqttService.unsubscribe(
      this.connectionId(),
      subscription.id,
      subscription.topic,
    );
    this.subscriptions.update((subs) =>
      subs.filter((s) => s.id !== subscription.id),
    );
  }

  private async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const connection = await this.connectionsService.get(
        this.connectionId(),
      );
      this.subscriptions.set(connection?.subscriptions ?? []);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.loading.set(false);
    }
  }
}
