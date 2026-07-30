import { Component, DestroyRef, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";

import {
  NewBrokerConnection,
  UpdateBrokerConnection,
} from "../../core/models/broker-connection.model";
import { MqttEvent } from "../../core/models/mqtt-event.model";
import { ConnectionsService } from "../../core/services/connections.service";
import { MqttEventsService } from "../../core/services/mqtt-events.service";
import { randomClientId } from "./client-id";

const NUMERIC_PATTERN = /^\d+$/;
const TEST_TIMEOUT_MS = 6000;

export type TestStatus = "idle" | "testing" | "success" | "error";

@Component({
  selector: "app-connection-form",
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: "./connection-form.html",
  styleUrl: "./connection-form.css",
})
export class ConnectionForm {
  private readonly connectionsService = inject(ConnectionsService);
  private readonly mqttEvents = inject(MqttEventsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly formBuilder = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  readonly editId = signal<string | null>(
    this.route.snapshot.paramMap.get("id"),
  );
  readonly loading = signal(this.editId() !== null);
  readonly loadError = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly testStatus = signal<TestStatus>("idle");
  readonly testError = signal<string | null>(null);

  readonly form = this.formBuilder.nonNullable.group({
    name: ["", Validators.required],
    host: ["", Validators.required],
    port: ["1883", [Validators.required, Validators.pattern(NUMERIC_PATTERN)]],
    clientId: [randomClientId(), Validators.required],
    keepAliveSecs: [
      "60",
      [Validators.required, Validators.pattern(NUMERIC_PATTERN)],
    ],
    useTls: [false],
    autoReconnect: [true],
    maxReconnectAttempts: [
      "10",
      [Validators.required, Validators.pattern(NUMERIC_PATTERN)],
    ],
    requiresAuth: [false],
    username: [""],
    password: [""],
  });

  constructor() {
    // A test result only speaks to the values it was run with - once you
    // change anything, it's stale and shouldn't keep showing "Connected
    // successfully" (or a since-fixed error) next to the button.
    const subscription = this.form.valueChanges.subscribe(() => {
      if (this.testStatus() !== "testing") {
        this.testStatus.set("idle");
        this.testError.set(null);
      }
    });
    this.destroyRef.onDestroy(() => subscription.unsubscribe());

    const id = this.editId();
    if (id !== null) {
      void this.loadExistingConnection(id);
    }
  }

  async submit(): Promise<void> {
    if (this.form.invalid || this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.error.set(null);
    try {
      const id = this.editId();
      if (id !== null) {
        await this.connectionsService.update(id, this.buildConnectionFields());
        await this.router.navigate(["/connections"]);
      } else {
        const created = await this.connectionsService.create(
          this.buildNewConnection(),
        );
        // BrokerWorkspace connects on its own when it mounts - connecting
        // here too would race it: both attempts share the same client_id,
        // so the broker disconnects whichever one loses the race, and
        // BrokerWorkspace (which is now listening) reports that spurious
        // disconnect as "Connection failed".
        await this.router.navigate(["/broker", created.id]);
      }
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.submitting.set(false);
    }
  }

  private async loadExistingConnection(id: string): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const connection = await this.connectionsService.get(id);
      if (connection === null) {
        this.loadError.set("Connection not found");
        return;
      }
      this.form.setValue({
        name: connection.name,
        host: connection.host,
        port: String(connection.port),
        clientId: connection.client_id,
        keepAliveSecs: String(connection.keep_alive_secs),
        useTls: connection.use_tls,
        autoReconnect: connection.auto_reconnect,
        maxReconnectAttempts: String(connection.max_reconnect_attempts),
        requiresAuth: connection.username !== null,
        username: connection.username ?? "",
        password: connection.password ?? "",
      });
    } catch (err) {
      this.loadError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** Tries connecting with the current form values without saving
   * anything, so you can sanity-check host/port/credentials first. */
  async testConnection(): Promise<void> {
    if (this.testStatus() === "testing") {
      return;
    }
    if (this.form.controls.host.invalid || this.form.controls.port.invalid) {
      return;
    }

    this.testStatus.set("testing");
    this.testError.set(null);

    const seenEvents: MqttEvent[] = [];
    let targetId: string | null = null;
    let resolveMatch: ((event: MqttEvent) => void) | null = null;

    const matches = (event: MqttEvent): boolean =>
      targetId !== null &&
      (("Connected" in event && event.Connected.connection_id === targetId) ||
        ("Disconnected" in event &&
          event.Disconnected.connection_id === targetId));

    // Subscribe *before* kicking off the connect attempt below - a fast
    // (e.g. local) broker can reply before an interleaved subscribe would
    // even finish registering its Tauri event listener, silently dropping
    // the event and stalling until the timeout instead of resolving right
    // away. Buffer everything and match retroactively once the ephemeral
    // id comes back, rather than only listening for events from then on.
    const subscription = this.mqttEvents.events$.subscribe((event) => {
      seenEvents.push(event);
      if (matches(event)) {
        resolveMatch?.(event);
      }
    });

    let ephemeralId: string | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
      const waitForLiveMatch = new Promise<MqttEvent>((resolve) => {
        resolveMatch = resolve;
      });

      ephemeralId = await this.connectionsService.testConnection(
        this.buildNewConnection(),
      );
      targetId = ephemeralId;

      const alreadySeen = seenEvents.find(matches);
      const result =
        alreadySeen ??
        (await new Promise<MqttEvent>((resolve, reject) => {
          timeoutHandle = setTimeout(() => {
            const timeoutErr = new Error(
              "Timed out waiting for a response from the broker",
            );
            timeoutErr.name = "TimeoutError";
            reject(timeoutErr);
          }, TEST_TIMEOUT_MS);
          void waitForLiveMatch.then(resolve);
        }));

      if ("Connected" in result) {
        this.testStatus.set("success");
      } else {
        this.testStatus.set("error");
        this.testError.set("Could not connect to the broker");
      }
    } catch (err) {
      this.testStatus.set("error");
      if (err instanceof Error && err.name === "TimeoutError") {
        this.testError.set("Timed out waiting for a response from the broker");
      } else {
        this.testError.set(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
      subscription.unsubscribe();
      if (ephemeralId !== null) {
        await this.connectionsService.disconnect(ephemeralId).catch(() => undefined);
      }
    }
  }

  private buildConnectionFields(): UpdateBrokerConnection {
    const value = this.form.getRawValue();
    return {
      name: value.name,
      host: value.host,
      port: Number(value.port),
      client_id: value.clientId,
      username: value.requiresAuth ? value.username : null,
      password: value.requiresAuth ? value.password : null,
      use_tls: value.useTls,
      keep_alive_secs: Number(value.keepAliveSecs),
      auto_reconnect: value.autoReconnect,
      max_reconnect_attempts: Number(value.maxReconnectAttempts),
    };
  }

  private buildNewConnection(): NewBrokerConnection {
    return { ...this.buildConnectionFields(), subscriptions: [] };
  }
}
