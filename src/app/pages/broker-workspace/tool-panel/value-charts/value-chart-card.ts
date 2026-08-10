import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from "@angular/core";
import { Subscription } from "rxjs";

import { StoredMessage } from "../../../../core/models/stored-message.model";
import { MessageStoreService } from "../../../../core/services/message-store.service";
import { ChartSpec } from "../../../../core/services/value-charts.service";
import { formatSampleValue } from "./axis-format";
import {
  CHART_VIEW_HEIGHT,
  CHART_VIEW_WIDTH,
  computeChartGeometry,
} from "./chart-geometry";
import { parsePayload } from "./numeric-fields";
import { buildSamples } from "./sample-series";

/** Half a line of text, kept inside the plot so an edge tick isn't clipped. */
const LABEL_INSET_PX = 6;

interface ValueLabel {
  readonly text: string;
  /** Pixels from the top of the plot. */
  readonly top: number;
}

interface TimeLabel {
  readonly text: string;
  /** Percentage across the plot. */
  readonly left: number;
  /** Percentage of its own width to shift by, so the first and last labels
   * sit inside the plot instead of hanging off either end. */
  readonly shift: number;
}

@Component({
  selector: "app-value-chart-card",
  templateUrl: "./value-chart-card.html",
  styleUrl: "./value-chart-card.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ValueChartCard {
  readonly spec = input.required<ChartSpec>();
  /** Frozen by the message stream's Pause, so the whole workspace holds still
   * together - studying a spike is hard if the line keeps moving under it. */
  readonly paused = input(false);
  readonly removeRequested = output<string>();

  readonly viewWidth = CHART_VIEW_WIDTH;
  readonly viewHeight = CHART_VIEW_HEIGHT;

  private readonly messageStore = inject(MessageStoreService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly messages = signal<readonly StoredMessage[]>([]);

  // Decoding and JSON.parse are memoized per message because the store hands
  // back the whole (<=500) history on every arrival. Without this, N open
  // charts each re-parse 500 payloads per message; with it, each parses one.
  // Keyed on the message object, which the store preserves across emissions -
  // the same trick as message-stream's measured row heights. A WeakMap needs
  // no invalidation: evicted messages take their entries with them.
  private readonly parsed = new WeakMap<StoredMessage, ParsedPayload>();

  private readonly samples = computed(() =>
    buildSamples(this.messages(), this.spec().fieldPath, (message) =>
      this.parseOnce(message),
    ),
  );

  readonly geometry = computed(() =>
    computeChartGeometry(this.samples(), {
      width: CHART_VIEW_WIDTH,
      height: CHART_VIEW_HEIGHT,
    }),
  );

  readonly hasData = computed(() => this.samples().length > 0);

  /** The newest reading, shown large - for a lot of topics that number is
   * more useful than the line, and it costs nothing to surface. */
  readonly currentValue = computed(() => {
    const samples = this.samples();
    return samples.length === 0
      ? null
      : formatSampleValue(samples[samples.length - 1].v);
  });

  /** True once messages are arriving but none of them carry the field any
   * more - a payload whose shape changed mid-session. */
  readonly fieldMissing = computed(
    () => this.messages().length > 0 && this.samples().length === 0,
  );

  readonly latestPoint = computed(() => {
    const points = this.geometry().points;
    return points.length === 0 ? null : points[points.length - 1];
  });

  readonly valueLabels = computed<readonly ValueLabel[]>(() =>
    this.geometry().valueTicks.map((tick) => ({
      text: tick.label,
      top: clamp(tick.position, LABEL_INSET_PX, CHART_VIEW_HEIGHT - LABEL_INSET_PX),
    })),
  );

  readonly timeLabels = computed<readonly TimeLabel[]>(() => {
    const ticks = this.geometry().timeTicks;
    const lastIndex = ticks.length - 1;
    return ticks.map((tick, index) => ({
      text: tick.label,
      left: (tick.position / CHART_VIEW_WIDTH) * 100,
      shift:
        lastIndex === 0
          ? -50
          : index === 0
            ? 0
            : index === lastIndex
              ? -100
              : -50,
    }));
  });

  readonly sampleCountLabel = computed(() => {
    const count = this.samples().length;
    return `${count} ${count === 1 ? "point" : "points"}`;
  });

  private subscription: Subscription | null = null;
  /** What arrived while paused. Buffered rather than dropped so resuming
   * shows the real history, not a gap. */
  private pending: readonly StoredMessage[] | null = null;

  constructor() {
    effect(() => {
      const spec = this.spec();
      untracked(() => this.subscribeTo(spec));
    });

    effect(() => {
      if (this.paused()) {
        return;
      }
      const pending = this.pending;
      if (pending !== null) {
        this.pending = null;
        untracked(() => this.messages.set(pending));
      }
    });

    this.destroyRef.onDestroy(() => this.subscription?.unsubscribe());
  }

  remove(): void {
    this.removeRequested.emit(this.spec().id);
  }

  private subscribeTo(spec: ChartSpec): void {
    this.subscription?.unsubscribe();
    this.pending = null;
    this.subscription = this.messageStore
      .messagesFor(spec.connectionId, spec.topic)
      .subscribe((messages) => {
        if (this.paused()) {
          this.pending = messages;
          return;
        }
        this.messages.set(messages);
      });
  }

  private parseOnce(message: StoredMessage): unknown {
    const cached = this.parsed.get(message);
    if (cached !== undefined) {
      return cached.value;
    }
    // Boxed so a payload that parses to `undefined` is still a cache hit
    // rather than being re-parsed on every emission.
    const value = parsePayload(message.payload);
    this.parsed.set(message, { value });
    return value;
  }
}

interface ParsedPayload {
  readonly value: unknown;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
