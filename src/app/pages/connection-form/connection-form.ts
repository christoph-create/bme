import { Component, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";

import { NewBrokerConnection } from "../../core/models/broker-connection.model";
import { ConnectionsService } from "../../core/services/connections.service";
import { randomClientId } from "./client-id";

const NUMERIC_PATTERN = /^\d+$/;

@Component({
  selector: "app-connection-form",
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: "./connection-form.html",
  styleUrl: "./connection-form.css",
})
export class ConnectionForm {
  private readonly connectionsService = inject(ConnectionsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly formBuilder = inject(FormBuilder);

  readonly editId = signal<string | null>(
    this.route.snapshot.paramMap.get("id"),
  );
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

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
    requiresAuth: [false],
    username: [""],
    password: [""],
  });

  async submit(): Promise<void> {
    if (this.form.invalid || this.submitting()) {
      return;
    }

    const value = this.form.getRawValue();
    const newConnection: NewBrokerConnection = {
      name: value.name,
      host: value.host,
      port: Number(value.port),
      client_id: value.clientId,
      username: value.requiresAuth ? value.username : null,
      password: value.requiresAuth ? value.password : null,
      use_tls: value.useTls,
      keep_alive_secs: Number(value.keepAliveSecs),
      subscriptions: [],
    };

    this.submitting.set(true);
    this.error.set(null);
    try {
      const created = await this.connectionsService.create(newConnection);
      await this.connectionsService.connect(created.id);
      await this.router.navigate(["/broker", created.id]);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.submitting.set(false);
    }
  }
}
