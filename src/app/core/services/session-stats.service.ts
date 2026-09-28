import {
  DestroyRef,
  Injectable,
  Signal,
  computed,
  inject,
  signal,
} from "@angular/core";

import { connectionIdOf } from "../status/connection-status";
import {
  SessionStats,
  emptySessionStats,
  recordPublished,
  reduceSessionStats,
} from "../stats/session-stats";
import { MqttEventsService } from "./mqtt-events.service";

/**
 * How much each broker connection has moved this session.
 *
 * Root-scoped and driven by one subscription to the event stream, for the
 * same reason `ConnectionStatusService` is: a connection keeps working after
 * you navigate away from its workspace, and a counter that only ran while
 * someone was looking would be worse than none.
 *
 * Session-only. Nothing here is persisted, and nothing survives a restart.
 *
 * There is deliberately no timer in this service. Uptime and the rolling rate
 * are read from the record by whoever is showing them, on their own tick -
 * so a connection nobody is watching costs nothing to keep counting.
 */
@Injectable({ providedIn: "root" })
export class SessionStatsService {
  private readonly state = signal<ReadonlyMap<string, SessionStats>>(new Map());

  constructor() {
    const events = inject(MqttEventsService);
    const destroyRef = inject(DestroyRef);

    const subscription = events.events$.subscribe({
      next: (event) => {
        const connectionId = connectionIdOf(event);
        const now = Date.now();
        this.update(connectionId, (current) =>
          reduceSessionStats(current ?? emptySessionStats(now), event, now),
        );
      },
      // As in `MessageStoreService`: outside the Tauri webview there is no
      // event stream to recover into, so stop counting rather than throwing.
      error: () => undefined,
    });
    destroyRef.onDestroy(() => subscription.unsubscribe());
  }

  /**
   * A reactive read for one connection, null until it has done something.
   *
   * Creates a computed per call, so hold the result rather than calling this
   * from a template - use `statsOf` there. Same shape as
   * `ConnectionStatusService.statusFor`.
   */
  statsFor(connectionId: string): Signal<SessionStats | null> {
    return computed(() => this.statsOf(connectionId));
  }

  /** Reads one connection's counters inside whatever reactive context is
   * already running - a template's, typically. */
  statsOf(connectionId: string): SessionStats | null {
    return this.state().get(connectionId) ?? null;
  }

  /** Starts a fresh session. Pressing Connect is what calls this: an
   * auto-reconnect deliberately does not, so totals survive a blip. */
  reset(connectionId: string): void {
    this.state.update((current) =>
      new Map(current).set(connectionId, emptySessionStats(Date.now())),
    );
  }

  /** Drops a connection the app no longer has open, so a closed workspace or
   * a deleted broker leaves no counters behind. */
  forget(connectionId: string): void {
    this.state.update((current) => {
      if (!current.has(connectionId)) return current;
      const next = new Map(current);
      next.delete(connectionId);
      return next;
    });
  }

  /** Counts something the app published. Nothing comes back over the event
   * stream to say a publish happened, so it has to be told. */
  recordPublish(connectionId: string, bytes: number): void {
    this.update(connectionId, (current) =>
      recordPublished(current ?? emptySessionStats(Date.now()), bytes),
    );
  }

  private update(
    connectionId: string,
    next: (current: SessionStats | null) => SessionStats,
  ): void {
    this.state.update((current) => {
      const before = current.get(connectionId) ?? null;
      const updated = next(before);
      // Every `$SYS` message and every warning comes through here and changes
      // nothing; rebuilding the map anyway would wake every reader in the app
      // on each one. Same guard as `ConnectionStatusService.update`.
      if (updated === before) return current;
      return new Map(current).set(connectionId, updated);
    });
  }
}
