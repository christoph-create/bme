import { DestroyRef, Injectable, Signal, computed, inject, signal } from "@angular/core";

import {
  ConnectionStatus,
  DISCONNECTED_BY_BROKER,
  connectionIdOf,
  reduceStatus,
} from "../status/connection-status";
import { ConnectionsService } from "./connections.service";
import { MqttEventsService } from "./mqtt-events.service";

/** What a connection the app has never touched this session looks like. */
const UNKNOWN: ConnectionStatus = { kind: "disconnected", error: null };

/**
 * Every broker's connection status, for the whole app.
 *
 * Root-scoped and driven by one subscription to the event stream, because
 * status outlives whatever is showing it: a broker stays connected after you
 * navigate away from its workspace, and the tab bar and the connections list
 * both need to say so.
 */
@Injectable({ providedIn: "root" })
export class ConnectionStatusService {
  private readonly connectionsService = inject(ConnectionsService);

  private readonly state = signal<ReadonlyMap<string, ConnectionStatus>>(
    new Map(),
  );

  constructor() {
    const events = inject(MqttEventsService);
    const destroyRef = inject(DestroyRef);

    const subscription = events.events$.subscribe((event) => {
      this.update(connectionIdOf(event), (current) =>
        reduceStatus(current, event),
      );
    });
    destroyRef.onDestroy(() => subscription.unsubscribe());
  }

  /**
   * A reactive read for one connection.
   *
   * Creates a computed per call, so hold the result rather than calling this
   * from a template - use `statusOf` there.
   */
  statusFor(connectionId: string): Signal<ConnectionStatus> {
    return computed(() => this.statusOf(connectionId));
  }

  /** Reads one connection's status inside whatever reactive context is
   * already running - a template's, typically. */
  statusOf(connectionId: string): ConnectionStatus {
    return this.state().get(connectionId) ?? UNKNOWN;
  }

  async connect(connectionId: string): Promise<void> {
    this.set(connectionId, { kind: "connecting" });
    try {
      await this.connectionsService.connect(connectionId);
      // Deliberately stays `connecting`: the command resolving only means the
      // request was accepted. The Connected event is what confirms a session.
    } catch (err) {
      this.set(connectionId, { kind: "disconnected", error: message(err) });
    }
  }

  async disconnect(connectionId: string): Promise<void> {
    try {
      await this.connectionsService.disconnect(connectionId);
    } catch (err) {
      this.set(connectionId, { kind: "disconnected", error: message(err) });
      throw err;
    }
    // The backend's Disconnected event sets the same state; doing it here too
    // means a dropped event can't leave the spinner running forever.
    this.set(connectionId, { kind: "disconnected", error: null });
  }

  /**
   * Gives up on the retry loop without tearing anything else down, so the
   * topic tree and message history stay on screen and Retry is still there.
   */
  async stopReconnecting(connectionId: string): Promise<void> {
    let error: string | null = DISCONNECTED_BY_BROKER;
    try {
      await this.connectionsService.disconnect(connectionId);
    } catch (err) {
      error = message(err);
    }
    this.set(connectionId, { kind: "disconnected", error });
  }

  /** Drops a connection the app no longer knows about, so a deleted broker
   * does not leave a status behind for an id that will never be seen again. */
  forget(connectionId: string): void {
    this.state.update((current) => {
      if (!current.has(connectionId)) return current;
      const next = new Map(current);
      next.delete(connectionId);
      return next;
    });
  }

  private set(connectionId: string, status: ConnectionStatus): void {
    this.update(connectionId, () => status);
  }

  private update(
    connectionId: string,
    next: (current: ConnectionStatus) => ConnectionStatus,
  ): void {
    this.state.update((current) => {
      const before = current.get(connectionId) ?? UNKNOWN;
      const updated = next(before);
      // Every received message comes through here and leaves the status
      // untouched; rebuilding the map anyway would wake every reader in the
      // app on each one.
      if (updated === before) return current;
      return new Map(current).set(connectionId, updated);
    });
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
