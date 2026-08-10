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

import { StoredMessage } from "../../../../core/models/stored-message.model";
import { MessageStoreService } from "../../../../core/services/message-store.service";
import { ValueChartsService } from "../../../../core/services/value-charts.service";
import {
  NumericField,
  findNumericFields,
  mergeNumericFields,
  parsePayload,
} from "./numeric-fields";
import { ValueChartCard } from "./value-chart-card";

@Component({
  selector: "app-value-charts",
  imports: [ValueChartCard],
  templateUrl: "./value-charts.html",
  styleUrl: "./value-charts.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ValueCharts {
  readonly connectionId = input.required<string>();
  readonly selectedTopic = input<string | null>(null);
  /** Lays the cards out in two columns - only worth it once the panel has
   * taken over the message stream's width. */
  readonly wide = input(false);
  /** The message stream's Pause, which freezes the charts too. */
  readonly paused = input(false);

  private readonly charts = inject(ValueChartsService);
  private readonly messageStore = inject(MessageStoreService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly messages = signal<readonly StoredMessage[]>([]);

  readonly pickerOpen = signal(false);

  readonly openCharts = computed(() =>
    this.charts.charts().filter((c) => c.connectionId === this.connectionId()),
  );

  // Field discovery is memoized per message for the same reason the cards
  // memoize parsing: the store re-emits the whole history on every arrival,
  // so without this the union below would re-walk up to 500 payloads per
  // message. With it, only the newly arrived message is ever walked.
  private readonly fieldsByMessage = new WeakMap<
    StoredMessage,
    readonly NumericField[]
  >();

  /** Every numeric value this topic has been seen to carry, with its most
   * recent reading. Recomputed on every message, so the picker stays live
   * while it is open. */
  readonly selectedTopicFields = computed<readonly NumericField[]>(() => {
    const topic = this.selectedTopic();
    const messages = this.messages();
    if (topic === null || messages.length === 0) {
      return [];
    }
    const fallbackLabel = topicLeaf(topic);
    return mergeNumericFields(
      messages.map((message) => this.fieldsOf(message, fallbackLabel)),
    );
  });

  readonly addLabel = computed(() => {
    const topic = this.selectedTopic();
    return topic === null ? "Add chart" : `Add chart from ${topicLeaf(topic)}`;
  });

  /** Why the add button is unavailable, or null when it is available. The
   * distinction matters: "no messages yet" resolves itself, "no numeric
   * values" won't. */
  readonly addBlockedReason = computed(() => {
    const topic = this.selectedTopic();
    if (topic === null) {
      return "Select a topic to chart a value";
    }
    if (this.messages().length === 0) {
      return `No messages on ${topic} yet`;
    }
    if (this.selectedTopicFields().length === 0) {
      return "No numeric values in this topic's messages (booleans and text aren't charted)";
    }
    return null;
  });

  private subscription: Subscription | null = null;

  constructor() {
    effect(() => {
      const connectionId = this.connectionId();
      const topic = this.selectedTopic();
      untracked(() => this.watchSelectedTopic(connectionId, topic));
    });

    this.destroyRef.onDestroy(() => this.subscription?.unsubscribe());
  }

  openPicker(): void {
    if (this.addBlockedReason() === null) {
      this.pickerOpen.set(true);
    }
  }

  closePicker(): void {
    this.pickerOpen.set(false);
  }

  /** The picker is a checklist rather than a one-shot menu: charting three
   * values off one topic is the common case, and reopening it each time was
   * three clicks too many. */
  toggle(field: NumericField): void {
    const topic = this.selectedTopic();
    if (topic === null) {
      return;
    }
    const connectionId = this.connectionId();
    const existing = this.charts.find(connectionId, topic, field.path);
    if (existing) {
      this.charts.remove(existing.id);
    } else {
      this.charts.add({
        connectionId,
        topic,
        fieldPath: field.path,
        label: field.label,
      });
    }
  }

  isPicked(field: NumericField): boolean {
    const topic = this.selectedTopic();
    return (
      topic !== null &&
      this.charts.isCharted(this.connectionId(), topic, field.path)
    );
  }

  removeChart(id: string): void {
    this.charts.remove(id);
  }

  private fieldsOf(
    message: StoredMessage,
    fallbackLabel: string,
  ): readonly NumericField[] {
    const cached = this.fieldsByMessage.get(message);
    if (cached !== undefined) {
      return cached;
    }
    const fields = findNumericFields(parsePayload(message.payload), fallbackLabel);
    this.fieldsByMessage.set(message, fields);
    return fields;
  }

  private watchSelectedTopic(connectionId: string, topic: string | null): void {
    this.subscription?.unsubscribe();
    this.pickerOpen.set(false);
    if (topic === null) {
      this.messages.set([]);
      return;
    }
    this.subscription = this.messageStore
      .messagesFor(connectionId, topic)
      .subscribe((messages) => this.messages.set(messages));
  }
}

/** `sensors/kitchen/temp` -> `temp`, the least redundant thing to call a
 * chart whose payload is a bare number. */
function topicLeaf(topic: string): string {
  const segments = topic.split("/");
  return segments[segments.length - 1] || topic;
}
