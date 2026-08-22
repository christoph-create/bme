import { Component, computed, DestroyRef, inject, signal } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { open } from "@tauri-apps/plugin-dialog";

import {
  brokerUrl,
  BROKER_SCHEMES,
  certificateName,
  defaultPortFor,
  isTls,
  isWebSocket,
} from "../../core/connection/broker-url";
import {
  BrokerScheme,
  NewBrokerConnection,
  UpdateBrokerConnection,
} from "../../core/models/broker-connection.model";
import { MqttEvent } from "../../core/models/mqtt-event.model";
import { ConnectionsService } from "../../core/services/connections.service";
import { MqttEventsService } from "../../core/services/mqtt-events.service";
import { randomClientId } from "./client-id";
import {
  connectionToFormValue,
  formValueToConnection,
} from "./connection-fields";

const NUMERIC_PATTERN = /^\d+$/;
const TEST_TIMEOUT_MS = 6000;

/** Which control a Browse button fills in. */
export type CertificateField =
  "caCertPath" | "clientCertPath" | "clientKeyPath";

export type TestStatus = "idle" | "testing" | "success" | "error";

@Component({
  selector: "app-connection-form",
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: "./connection-form.html",
  // Two files purely for size: one was over the 4kB anyComponentStyle budget
  // in angular.json, the same reason publish-settings.css was split out.
  styleUrls: ["./connection-form.css", "./connection-form-sections.css"],
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

  readonly schemes = BROKER_SCHEMES;

  readonly form = this.formBuilder.nonNullable.group({
    name: ["", Validators.required],
    scheme: ["mqtt" as BrokerScheme],
    host: ["", Validators.required],
    port: ["1883", [Validators.required, Validators.pattern(NUMERIC_PATTERN)]],
    wsPath: [""],
    clientId: [randomClientId(), Validators.required],
    keepAliveSecs: [
      "60",
      [Validators.required, Validators.pattern(NUMERIC_PATTERN)],
    ],
    autoReconnect: [true],
    maxReconnectAttempts: [
      "10",
      [Validators.required, Validators.pattern(NUMERIC_PATTERN)],
    ],
    requiresAuth: [false],
    username: [""],
    password: [""],
    caCertPath: [""],
    clientCertPath: [""],
    clientKeyPath: [""],
    alpn: [""],
    skipCertVerification: [false],
  });

  /**
   * The form's value as a signal, so the endpoint URL and the
   * which-sections-are-visible checks below recompute as you type rather than
   * needing a change-detection pass to be read out of the FormGroup.
   */
  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  readonly scheme = computed<BrokerScheme>(() => this.value().scheme ?? "mqtt");
  readonly showsPath = computed(() => isWebSocket(this.scheme()));
  readonly showsTlsOptions = computed(() => isTls(this.scheme()));
  readonly requiresAuth = computed(() => this.value().requiresAuth ?? false);
  readonly autoReconnect = computed(() => this.value().autoReconnect ?? false);
  readonly skipsVerification = computed(
    () => this.value().skipCertVerification ?? false,
  );

  /** The endpoint as one line, assembled the way the backend assembles it. */
  readonly endpointUrl = computed(() => {
    const value = this.value();
    return brokerUrl(
      this.scheme(),
      value.host ?? "",
      value.port ?? "",
      value.wsPath ?? "",
    );
  });

  readonly caCertName = computed(() =>
    certificateName(this.value().caCertPath ?? ""),
  );
  readonly clientCertName = computed(() =>
    certificateName(this.value().clientCertPath ?? ""),
  );
  readonly clientKeyName = computed(() =>
    certificateName(this.value().clientKeyPath ?? ""),
  );

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

    // Picking a scheme moves the port with it, but only while the port is
    // still a default nobody has touched. Overwriting a hand-typed 8884 on the
    // way from mqtts to wss would be the more annoying half of the bargain.
    let previousScheme = this.form.controls.scheme.value;
    const schemeSubscription = this.form.controls.scheme.valueChanges.subscribe(
      (scheme) => {
        const port = this.form.controls.port.value;
        if (port === "" || port === String(defaultPortFor(previousScheme))) {
          this.form.controls.port.setValue(String(defaultPortFor(scheme)));
        }
        previousScheme = scheme;
      },
    );
    this.destroyRef.onDestroy(() => schemeSubscription.unsubscribe());

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
      this.form.setValue(connectionToFormValue(connection));
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
        // The backend attaches a reason for the failures it can name - a bad
        // certificate, a WebSocket path that isn't one - and those are exactly
        // the ones the generic line was useless for.
        this.testError.set(
          ("Disconnected" in result ? result.Disconnected.reason : null) ??
            "Could not connect to the broker",
        );
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
        await this.connectionsService
          .disconnect(ephemeralId)
          .catch(() => undefined);
      }
    }
  }

  /**
   * Opens a native file picker for one of the certificate fields. Only the
   * path is stored - the backend reads the file itself on every connect, so a
   * renewed certificate is picked up without coming back through here.
   */
  async pickCertificate(field: CertificateField): Promise<void> {
    const picked = await open({
      multiple: false,
      directory: false,
      title: "Choose a certificate file",
      filters: [
        {
          name: "Certificates and keys",
          extensions: ["pem", "crt", "cer", "key", "der"],
        },
        { name: "All files", extensions: ["*"] },
      ],
    });

    if (typeof picked === "string") {
      this.form.controls[field].setValue(picked);
    }
  }

  clearCertificate(field: CertificateField): void {
    this.form.controls[field].setValue("");
  }

  private buildConnectionFields(): UpdateBrokerConnection {
    return formValueToConnection(this.form.getRawValue());
  }

  private buildNewConnection(): NewBrokerConnection {
    return { ...this.buildConnectionFields(), subscriptions: [] };
  }
}
