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

import { qosNumber } from "../../../core/models/qos";
import { StoredMessage } from "../../../core/models/stored-message.model";
import { MessageStoreService } from "../../../core/services/message-store.service";
import { formatMessageBody } from "../format/payload-text";
import { formatTimeAgo } from "../format/time-ago";

const TICK_INTERVAL_MS = 1000;

/** Pre-formatted view of a message, so expensive work (JSON parsing, text
 * decoding) only re-runs when its inputs actually change, instead of on
 * every change-detection pass - with hundreds of messages in a session,
 * redoing that per template call made fast scrolling visibly janky. */
interface MessageView {
  readonly message: StoredMessage;
  readonly timeAgo: string;
  readonly qos: 0 | 1 | 2;
  readonly body: string;
}

@Component({
  selector: "app-message-stream",
  imports: [],
  templateUrl: "./message-stream.html",
  styleUrl: "./message-stream.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageStream {
  readonly connectionId = input.required<string>();
  readonly topic = input<string | null>(null);

  private readonly messageStore = inject(MessageStoreService);
  private readonly destroyRef = inject(DestroyRef);

  readonly messages = signal<readonly StoredMessage[]>([]);
  private readonly now = signal(Date.now());

  readonly prettyJson = signal(true);

  /** Newest first, matching how the panel displays received messages. */
  readonly messageViews = computed<readonly MessageView[]>(() => {
    const now = this.now();
    const prettyPrintJson = this.prettyJson();
    return [...this.messages()].reverse().map((message) => ({
      message,
      timeAgo: formatTimeAgo(now - message.receivedAt),
      qos: qosNumber(message.qos),
      body: formatMessageBody(message.payload, { prettyPrintJson }),
    }));
  });

  readonly messageCountLabel = computed(() => {
    const count = this.messages().length;
    return `${count} ${count === 1 ? "message" : "messages"} in this session`;
  });

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
