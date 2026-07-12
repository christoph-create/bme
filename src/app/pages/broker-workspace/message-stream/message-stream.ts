import {
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

import { qosNumber } from "../../../core/models/qos";
import { StoredMessage } from "../../../core/models/stored-message.model";
import { MessageStoreService } from "../../../core/services/message-store.service";
import { formatMessageBody } from "../format/payload-text";
import { formatTimeAgo } from "../format/time-ago";

const TICK_INTERVAL_MS = 1000;

@Component({
  selector: "app-message-stream",
  imports: [],
  templateUrl: "./message-stream.html",
  styleUrl: "./message-stream.css",
})
export class MessageStream {
  readonly connectionId = input.required<string>();
  readonly topic = input<string | null>(null);
  readonly qosNumber = qosNumber;

  private readonly messageStore = inject(MessageStoreService);
  private readonly destroyRef = inject(DestroyRef);

  readonly messages = signal<readonly StoredMessage[]>([]);
  private readonly now = signal(Date.now());

  /** Newest first, matching how the panel displays received messages. */
  readonly messagesDescending = computed(() => [...this.messages()].reverse());

  readonly messageCountLabel = computed(() => {
    const count = this.messages().length;
    return `${count} ${count === 1 ? "message" : "messages"} in this session`;
  });

  readonly prettyJson = signal(true);

  private topicSubscription: Subscription | null = null;

  constructor() {
    effect(() => {
      const connectionId = this.connectionId();
      const topic = this.topic();
      untracked(() => this.subscribeTo(connectionId, topic));
    });

    const tickHandle = setInterval(
      () => this.now.set(Date.now()),
      TICK_INTERVAL_MS,
    );
    this.destroyRef.onDestroy(() => {
      clearInterval(tickHandle);
      this.topicSubscription?.unsubscribe();
    });
  }

  timeAgo(receivedAt: number): string {
    return formatTimeAgo(this.now() - receivedAt);
  }

  body(payload: readonly number[]): string {
    return formatMessageBody(payload, { prettyPrintJson: this.prettyJson() });
  }

  togglePrettyJson(): void {
    this.prettyJson.update((pretty) => !pretty);
  }

  private subscribeTo(connectionId: string, topic: string | null): void {
    this.topicSubscription?.unsubscribe();
    if (topic === null) {
      this.messages.set([]);
      return;
    }
    this.topicSubscription = this.messageStore
      .messagesFor(connectionId, topic)
      .subscribe((messages) => this.messages.set(messages));
  }
}
