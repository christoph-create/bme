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

  /** The last thing that went wrong on a connection that survived it - kept
   * apart from `state` because it is orthogonal to `kind`: an oversize message
   * is worth reporting while the connection is up and working. */
  private readonly warnings = signal<ReadonlyMap<string, string>>(new Map());

  /** Connections the user has deliberately stopped. Events from the session
   * being torn down keep arriving after the command resolves, and the backend
   * cannot tell an intentional teardown from a broker that vanished - both are
   * a `Disconnected` with no reason. Whoever pressed the button knows, so the
   * decision is made here and held until the user asks to connect again.
   *
   * A plain Set rather than a signal: it is only ever read inside the event
   * subscription, never in a computed. */
  private readonly stopped = new Set<string>();

  constructor() {
    const events = inject(MqttEventsService);
    const destroyRef = inject(DestroyRef);

    const subscription = events.events$.subscribe((event) => {
      // Ahead of the Warning branch on purpose: a warning from a session the
      // user has already ended is as stale as its status.
      if (this.stopped.has(connectionIdOf(event))) return;
      if ("Warning" in event) {
        this.setWarning(event.Warning.connection_id, event.Warning.message);
        // Returns rather than falling through to `update`: a warning leaves the
        // status alone by definition, so there is nothing to reduce.
        return;
      }
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

  /** A reactive read of one connection's warning, as `statusFor` is of its
   * status: creates a computed per call, so hold the result. */
  warningFor(connectionId: string): Signal<string | null> {
    return computed(() => this.warningOf(connectionId));
  }

  warningOf(connectionId: string): string | null {
    return this.warnings().get(connectionId) ?? null;
  }

  dismissWarning(connectionId: string): void {
    this.warnings.update((current) => {
      if (!current.has(connectionId)) return current;
      const next = new Map(current);
      next.delete(connectionId);
      return next;
    });
  }

  async connect(connectionId: string): Promise<void> {
    // Pressing Connect or Retry starts a fresh story. Deliberately not cleared
    // on the Connected event instead: an oversize message drops and re-makes
    // the session, so a Connected lands moments after every warning and would
    // wipe it before it could be read.
    this.dismissWarning(connectionId);
    this.stopped.delete(connectionId);
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
    // Before the await, not after: the backend announces the teardown as a
    // `Disconnected` that is indistinguishable from a broker dropping us, and
    // it can land while the command is still in flight. Asking to stop is not
    // a fault, so nothing the dying session says may repaint this red.
    this.stopped.add(connectionId);
    try {
      await this.connectionsService.disconnect(connectionId);
    } catch (err) {
      // The session may well still be live, so its events have to keep
      // flowing - it is only a *successful* stop that ends the story.
      this.stopped.delete(connectionId);
      this.set(connectionId, { kind: "disconnected", error: message(err) });
      throw err;
    }
    this.set(connectionId, { kind: "disconnected", error: null });
  }

  /**
   * Gives up on the retry loop without tearing anything else down, so the
   * topic tree and message history stay on screen and Retry is still there.
   */
  async stopReconnecting(connectionId: string): Promise<void> {
    // Same reason as `disconnect`, and the case the backend could never have
    // got right on its own: Stop and Disconnect are one IPC command, but only
    // this one keeps the error banner and its Retry button up.
    this.stopped.add(connectionId);
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
    this.dismissWarning(connectionId);
    this.stopped.delete(connectionId);
    this.state.update((current) => {
      if (!current.has(connectionId)) return current;
      const next = new Map(current);
      next.delete(connectionId);
      return next;
    });
  }

  private setWarning(connectionId: string, warning: string): void {
    this.warnings.update((current) =>
      current.get(connectionId) === warning
        ? current
        : new Map(current).set(connectionId, warning),
    );
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
