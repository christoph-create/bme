import { Component, OnInit, inject, input, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";

import { Subscription } from "../../../core/models/broker-connection.model";
import { QoS } from "../../../core/models/qos";
import { ConnectionsService } from "../../../core/services/connections.service";
import { MqttService } from "../../../core/services/mqtt.service";

const QOS_OPTIONS: readonly QoS[] = ["AtMostOnce", "AtLeastOnce", "ExactlyOnce"];

@Component({
  selector: "app-subscriptions-panel",
  imports: [ReactiveFormsModule],
  templateUrl: "./subscriptions-panel.html",
  styleUrl: "./subscriptions-panel.css",
})
export class SubscriptionsPanel implements OnInit {
  readonly qosOptions = QOS_OPTIONS;
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

  selectQos(qos: QoS): void {
    this.qos.set(qos);
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
