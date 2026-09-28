import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from "@angular/core";

import { SessionStatsService } from "../../../../core/services/session-stats.service";
import { readRateWindow } from "../../../../core/stats/rate-window";
import { BusiestTopic, busiestTopics } from "./busiest-topics";
import {
  NO_VALUE,
  formatByteRate,
  formatBytes,
  formatCount,
  formatDuration,
  formatRate,
} from "./format-stat";
import { StatTile } from "./stat-tile";
import { SysStats } from "./sys-stats";

/** Matches the topic tree's own clock: a readout that moves once a second
 * reads as live, and moving faster than that just burns repaints. */
const TICK_INTERVAL_MS = 1000;

const BUSIEST_TOPIC_COUNT = 5;

/**
 * How this connection is doing, as the Tools dock's second tool.
 *
 * Reads `SessionStatsService`, which counts whether or not this panel is
 * open, so switching to this tab shows the whole session rather than starting
 * one. The tick is owned here rather than in the service for the same reason:
 * a connection nobody is looking at should not be paying for a timer.
 */
@Component({
  selector: "app-broker-stats",
  imports: [StatTile, SysStats],
  templateUrl: "./broker-stats.html",
  styleUrl: "./broker-stats.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrokerStats {
  readonly connectionId = input.required<string>();
  /** Wide enough to put the two sections side by side. The tile grids reflow
   * on their own, so this only decides the coarser layout. */
  readonly wide = input(false);
  /** Whether there is a live session, for the `$SYS` section's states. */
  readonly connected = input(false);

  private readonly sessionStats = inject(SessionStatsService);

  /** Drives the two readings that change without an event arriving: uptime,
   * and a rate decaying towards zero on a connection that has gone quiet. */
  private readonly now = signal(Date.now());

  private readonly stats = computed(() =>
    this.sessionStats.statsOf(this.connectionId()),
  );

  readonly hasSession = computed(() => this.stats() !== null);

  private readonly rate = computed(() => {
    const stats = this.stats();
    return stats === null ? null : readRateWindow(stats.rate, this.now());
  });

  readonly uptime = computed(() => {
    const stats = this.stats();
    return stats === null
      ? NO_VALUE
      : formatDuration(this.now() - stats.startedAt);
  });

  /** An uptime with no link behind it is the last known value, not a running
   * clock - worth showing, worth dimming. */
  readonly linkDown = computed(() => this.stats()?.connectedAt === null);

  readonly messagesIn = computed(() =>
    formatCount(this.stats()?.messagesIn ?? 0),
  );
  readonly payloadIn = computed(() =>
    formatBytes(this.stats()?.payloadBytesIn ?? 0),
  );
  readonly messagesOut = computed(() =>
    formatCount(this.stats()?.messagesOut ?? 0),
  );
  readonly payloadOut = computed(() =>
    formatBytes(this.stats()?.payloadBytesOut ?? 0),
  );
  readonly reconnects = computed(() =>
    formatCount(this.stats()?.reconnects ?? 0),
  );

  readonly messageRate = computed(() =>
    formatRate(this.rate()?.messagesPerSecond ?? null),
  );
  readonly byteRate = computed(() =>
    formatByteRate(this.rate()?.bytesPerSecond ?? null),
  );
  readonly rateSeries = computed<readonly number[]>(
    () => this.rate()?.series ?? [],
  );

  readonly busiest = computed<readonly BusiestTopic[]>(() => {
    const stats = this.stats();
    return stats === null
      ? []
      : busiestTopics(stats.perTopic, BUSIEST_TOPIC_COUNT);
  });

  constructor() {
    const handle = setInterval(
      () => this.now.set(Date.now()),
      TICK_INTERVAL_MS,
    );
    inject(DestroyRef).onDestroy(() => clearInterval(handle));
  }
}
