import { Injectable, computed, signal } from "@angular/core";
import { invoke } from "@tauri-apps/api/core";

import {
  NewPayloadVariable,
  PayloadVariable,
  UpdatePayloadVariable,
  VariableValueKind,
  valueKindOf,
} from "../models/payload-variable.model";

/**
 * The `{{placeholder}}` definitions, app-wide.
 *
 * Unlike the other repository wrappers this one keeps a loaded-once signal
 * cache. The publish panel needs the definitions *synchronously* on every
 * keystroke - to validate the payload and render the preview - and an
 * `invoke()` per keystroke is not that. Every mutation refreshes the cache, so
 * there's still exactly one source of truth; the signal is just a local read
 * model of it.
 */
@Injectable({ providedIn: "root" })
export class VariablesService {
  private readonly variablesSignal = signal<readonly PayloadVariable[]>([]);
  private loading: Promise<void> | null = null;

  /** Empty until the first `load()` resolves. Callers that only read (the
   * preview, the insert menu) can treat that as "no variables yet" - the
   * panel calls `load()` on init. */
  readonly variables = this.variablesSignal.asReadonly();

  /** Value kinds by name, the map placeholder-aware JSON validation wants.
   * A computed rather than a method: it's read on every keystroke, and the
   * inputs only change when a variable is added, edited or removed. */
  readonly valueKinds = computed<ReadonlyMap<string, VariableValueKind>>(
    () =>
      new Map(
        this.variablesSignal().map((v) => [v.name, valueKindOf(v.generator)]),
      ),
  );

  /** Loads once per app run unless `force`d. Concurrent callers share the
   * same in-flight promise rather than each firing their own IPC call. */
  load(force = false): Promise<void> {
    if (force) {
      this.loading = null;
    }
    // A rejected load must not be cached, or one failure would poison every
    // later call with the same stale error.
    this.loading ??= this.refresh().catch((err: unknown) => {
      this.loading = null;
      throw err;
    });
    return this.loading;
  }

  list(): Promise<PayloadVariable[]> {
    return invoke("list_payload_variables");
  }

  get(id: string): Promise<PayloadVariable | null> {
    return invoke("get_payload_variable", { id });
  }

  async create(newVariable: NewPayloadVariable): Promise<PayloadVariable> {
    const created = await invoke<PayloadVariable>("create_payload_variable", {
      newVariable,
    });
    await this.load(true);
    return created;
  }

  async update(
    id: string,
    update: UpdatePayloadVariable,
  ): Promise<PayloadVariable> {
    const updated = await invoke<PayloadVariable>("update_payload_variable", {
      id,
      update,
    });
    await this.load(true);
    return updated;
  }

  async delete(id: string): Promise<void> {
    await invoke("delete_payload_variable", { id });
    await this.load(true);
  }

  private async refresh(): Promise<void> {
    this.variablesSignal.set(await this.list());
  }
}
