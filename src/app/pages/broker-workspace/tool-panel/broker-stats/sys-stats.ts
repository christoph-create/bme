import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from "@angular/core";
import { Subscription } from "rxjs";

import { isSystemTopic } from "../../../../core/mqtt/system-topics";
import { StoredMessage } from "../../../../core/models/stored-message.model";
import { MessageStoreService } from "../../../../core/services/message-store.service";
import { SystemMonitorService } from "../../../../core/services/system-monitor.service";
import { formatPayloadPreview } from "../../format/payload-text";
import { StatTile } from "./stat-tile";
import { SysGroup } from "./sys-classify";
import { SPARKLINE_CONCEPTS } from "./sys-concepts";
import { sysDashboardState } from "./sys-dashboard-state";
import {
  SysDashboard,
  SysReading,
  parseSysNumber,
  readSysDashboard,
} from "./sys-topics";

const TICK_INTERVAL_MS = 1000;

/**
 * The broker's own health, read from `$SYS`.
 *
 * The history comes from `MessageStoreService` like any other topic, which is
 * what gives the sparklines their shape for free and lets a raw `$SYS`
 * message be inspected in the stream like anything else. Two consequences
 * worth knowing rather than "fixing" with a second store: the sparklines are
 * bounded by `maxMessagesPerTopic`, and a Clear elsewhere in the UI wipes
 * this history too. Both are fine for a live dashboard.
 */
@Component({
  selector: "app-sys-stats",
  imports: [StatTile],
  templateUrl: "./sys-stats.html",
  styleUrl: "./sys-stats.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SysStats {
  readonly connectionId = input.required<string>();
  readonly connected = input(false);

  private readonly monitor = inject(SystemMonitorService);
  private readonly messageStore = inject(MessageStoreService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly topics = signal<
    ReadonlyMap<string, readonly StoredMessage[]>
  >(new Map());
  private readonly now = signal(Date.now());
  /** When monitoring last started on a live session, so silence can be given
   * a grace period before it is called an answer. */
  private readonly watchingSince = signal<number | null>(null);

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  /** Detail groups the user has opened. Collapsed by default: a broker can
   * publish a hundred-odd readings, and the tiles above are the answer to
   * "how is it doing". */
  readonly openGroups = signal<ReadonlySet<SysGroup>>(new Set());

  readonly monitoring = computed(() =>
    this.monitor.isMonitoring(this.connectionId()),
  );

  /** Every `$SYS` topic's latest value, decoded. */
  private readonly latest = computed<ReadonlyMap<string, string>>(() => {
    const latest = new Map<string, string>();
    for (const [topic, messages] of this.topics()) {
      if (!isSystemTopic(topic) || messages.length === 0) {
        continue;
      }
      const last = messages[messages.length - 1];
      latest.set(topic, formatPayloadPreview(last.payload, last.payloadLen));
    }
    return latest;
  });

  private readonly dashboard = computed<SysDashboard>(() =>
    readSysDashboard(this.latest()),
  );

  readonly headline = computed<readonly SysReading[]>(
    () => this.dashboard().headline,
  );
  readonly details = computed(() => this.dashboard().details);

  readonly state = computed(() => {
    const since = this.watchingSince();
    return sysDashboardState({
      connected: this.connected(),
      monitoring: this.monitoring(),
      sysTopicCount: this.latest().size,
      msSinceStart: since === null ? 0 : this.now() - since,
    });
  });

  private subscription: Subscription | null = null;

  constructor() {
    effect(() => {
      const connectionId = this.connectionId();
      untracked(() => this.watch(connectionId));
    });

    // Only reason the clock is needed: turning "waiting" into "unsupported"
    // when nothing arrives. Everything else here changes because a message
    // did.
    effect(() => {
      const watching = this.monitoring() && this.connected();
      untracked(() =>
        this.watchingSince.update((since) =>
          watching ? (since ?? Date.now()) : null,
        ),
      );
    });

    const handle = setInterval(
      () => this.now.set(Date.now()),
      TICK_INTERVAL_MS,
    );
    this.destroyRef.onDestroy(() => {
      clearInterval(handle);
      this.subscription?.unsubscribe();
    });
  }

  sparklineFor(reading: SysReading): readonly number[] {
    if (
      reading.conceptId === undefined ||
      !SPARKLINE_CONCEPTS.has(reading.conceptId)
    ) {
      return [];
    }
    const messages = this.topics().get(reading.topic) ?? [];
    const series: number[] = [];
    for (const message of messages) {
      const value = parseSysNumber(
        formatPayloadPreview(message.payload, message.payloadLen),
      );
      if (value !== null) {
        series.push(value);
      }
    }
    return series;
  }

  isGroupOpen(group: SysGroup): boolean {
    return this.openGroups().has(group);
  }

  toggleGroup(group: SysGroup): void {
    this.openGroups.update((open) => {
      const next = new Set(open);
      if (!next.delete(group)) {
        next.add(group);
      }
      return next;
    });
  }

  async toggleMonitoring(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      if (this.monitoring()) {
        await this.monitor.stop(this.connectionId());
      } else {
        await this.monitor.start(this.connectionId());
      }
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.busy.set(false);
    }
  }

  private watch(connectionId: string): void {
    this.subscription?.unsubscribe();
    this.subscription = this.messageStore
      .topicsFor(connectionId)
      .subscribe((topics) => this.topics.set(topics));
  }
}
