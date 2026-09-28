import {
  DestroyRef,
  Injectable,
  Signal,
  computed,
  inject,
  signal,
} from "@angular/core";
import { invoke } from "@tauri-apps/api/core";
import { take } from "rxjs";

import { isSystemTopic } from "../mqtt/system-topics";
import { LoggerService } from "./logger.service";
import { MessageStoreService } from "./message-store.service";
import { MqttEventsService } from "./mqtt-events.service";
import { MqttService } from "./mqtt.service";

/** The `app_settings` row that remembers the toggle for one broker.
 *
 * Namespaced `area.name` per the storage convention, with the connection id
 * as the name. A row per connection rather than one row holding a list,
 * because that is what makes deleting a broker a single `remove_app_setting`
 * instead of a read-modify-write. The backend never reads these; this module
 * is their schema, and an absent row means "off". */
function keyFor(connectionId: string): string {
  return `sys.monitor.${connectionId}`;
}

const KEY_PREFIX = "sys.monitor.";
const ENABLED = "true";

/**
 * Which brokers the app is reading `$SYS` from, and keeping it that way.
 *
 * Remembered per connection, so turning the broker panel on once survives a
 * restart - but deliberately *not* part of `AppSettings`, which is the global
 * schema. This is per-broker state that happens to live in the same untyped
 * key/value table (see `keyFor`).
 *
 * Off by default, and never turned on by opening the panel: subscribing is
 * traffic the user did not ask for, and on a broker with a `$SYS` ACL the
 * SUBSCRIBE may be refused or logged.
 */
@Injectable({ providedIn: "root" })
export class SystemMonitorService {
  private readonly mqtt = inject(MqttService);
  private readonly messageStore = inject(MessageStoreService);
  private readonly logger = inject(LoggerService);

  private readonly monitored = signal<ReadonlySet<string>>(new Set());
  private loading: Promise<void> | null = null;

  constructor() {
    const events = inject(MqttEventsService);
    const destroyRef = inject(DestroyRef);

    const subscription = events.events$.subscribe({
      next: (event) => {
        if ("Connected" in event) {
          void this.reapply(event.Connected.connection_id);
        }
      },
      // As in `MessageStoreService`: outside the Tauri webview there is no
      // stream to recover into.
      error: () => undefined,
    });
    destroyRef.onDestroy(() => subscription.unsubscribe());
  }

  /**
   * A reactive read for one connection.
   *
   * Creates a computed per call, so hold the result rather than calling it
   * from a template - use `isMonitoring` there. Same convention as
   * `ConnectionStatusService.statusFor` / `statusOf`.
   */
  monitoringFor(connectionId: string): Signal<boolean> {
    return computed(() => this.isMonitoring(connectionId));
  }

  isMonitoring(connectionId: string): boolean {
    return this.monitored().has(connectionId);
  }

  /** Loads the remembered flags once per app run; concurrent callers share
   * the in-flight promise and a rejection isn't cached, so a later call can
   * retry. Same shape as `SettingsService.load`. */
  load(force = false): Promise<void> {
    if (force) {
      this.loading = null;
    }
    this.loading ??= this.refresh().catch((err: unknown) => {
      this.loading = null;
      throw err;
    });
    return this.loading;
  }

  /** Starts reading `$SYS` from this broker, and remembers it.
   *
   * Rejects if the broker isn't connected - `subscribe_system_topics` has no
   * saved list to fall back on, and a toggle left on with nothing behind it
   * looks exactly like a broker that publishes no `$SYS`. */
  async start(connectionId: string): Promise<void> {
    this.set(connectionId, true);
    try {
      await this.mqtt.subscribeSystemTopics(connectionId);
    } catch (err) {
      // Back off rather than lie about what the app is reading.
      this.set(connectionId, false);
      throw err;
    }
    await invoke("set_app_setting", {
      key: keyFor(connectionId),
      value: ENABLED,
    });
  }

  /** Stops reading `$SYS`, forgets the preference, and drops what was read.
   *
   * Clearing matters: leaving the history behind would leave the panel
   * showing numbers that have quietly stopped moving, which is worse than
   * showing none. */
  async stop(connectionId: string): Promise<void> {
    this.set(connectionId, false);
    this.clearSystemTopics(connectionId);
    // Removed rather than written as "false": an absent row is what "not
    // monitoring" looks like everywhere else in this table.
    await invoke("remove_app_setting", { key: keyFor(connectionId) });
    try {
      await this.mqtt.unsubscribeSystemTopics(connectionId);
    } catch {
      // The session may already be gone, in which case there is nothing left
      // to unsubscribe from and nothing to report.
    }
  }

  /** Drops everything about a broker the app no longer knows - for a deleted
   * connection, so its row doesn't outlive it. Closing a workspace
   * deliberately does *not* come through here: the tab going away is not the
   * user changing their mind. */
  async forget(connectionId: string): Promise<void> {
    this.set(connectionId, false);
    await invoke("remove_app_setting", { key: keyFor(connectionId) });
  }

  /**
   * Re-subscribes after a session comes up.
   *
   * The load-bearing part of this service. The connection task replays its
   * own `SubscriptionSet` across an auto-reconnect, so `$SYS/#` survives a
   * broker blip - but `connect_broker` spawns a *fresh* task seeded from the
   * database (`SubscriptionSet::from_broker`), and `$SYS/#` is deliberately
   * not in there. Without this, the panel silently freezes after any manual
   * Disconnect then Connect.
   *
   * Safe to repeat: `SubscriptionSet::insert` replaces a known topic in place
   * rather than appending, so re-issuing on every `Connected` costs one
   * SUBSCRIBE and needs no bookkeeping about whether this session already
   * did it.
   */
  private async reapply(connectionId: string): Promise<void> {
    try {
      await this.load();
    } catch {
      // Nothing read means nothing to reapply; `load` has already cleared its
      // cached failure so the next connect tries again.
      return;
    }
    if (!this.isMonitoring(connectionId)) {
      return;
    }
    try {
      await this.mqtt.subscribeSystemTopics(connectionId);
    } catch (err) {
      // Deliberately does not flip the toggle off: the user's preference
      // outlives one failed SUBSCRIBE, and the panel's own "waiting" state is
      // what tells them nothing is arriving.
      this.logger.debug(
        `system monitor: could not re-subscribe connection=${connectionId}: ${String(err)}`,
      );
    }
  }

  private clearSystemTopics(connectionId: string): void {
    let topics: readonly string[] = [];
    // `topicsFor` is backed by a BehaviorSubject, so this runs through
    // synchronously - a snapshot, not a subscription worth holding.
    this.messageStore
      .topicsFor(connectionId)
      .pipe(take(1))
      .subscribe((known) => {
        topics = [...known.keys()].filter(isSystemTopic);
      });
    for (const topic of topics) {
      this.messageStore.clearTopic(connectionId, topic);
    }
  }

  private set(connectionId: string, monitoring: boolean): void {
    this.monitored.update((current) => {
      if (current.has(connectionId) === monitoring) return current;
      const next = new Set(current);
      if (monitoring) {
        next.add(connectionId);
      } else {
        next.delete(connectionId);
      }
      return next;
    });
  }

  private async refresh(): Promise<void> {
    const rows = await invoke<Record<string, string>>("list_app_settings");
    const monitored = new Set<string>();
    for (const [key, value] of Object.entries(rows)) {
      if (key.startsWith(KEY_PREFIX) && value === ENABLED) {
        monitored.add(key.slice(KEY_PREFIX.length));
      }
    }
    this.monitored.set(monitored);
  }
}
