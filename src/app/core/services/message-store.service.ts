import { Injectable, InjectionToken, inject } from "@angular/core";
import { BehaviorSubject, Observable, distinctUntilChanged, map } from "rxjs";

import { MqttMessageReceived } from "../models/mqtt-event.model";
import { StoredMessage } from "../models/stored-message.model";
import { LoggerService } from "./logger.service";
import { MqttEventsService } from "./mqtt-events.service";

const DEFAULT_MAX_MESSAGES_PER_TOPIC = 500;
const EMPTY_MESSAGES: readonly StoredMessage[] = [];
const EMPTY_TOPICS: ReadonlyMap<string, readonly StoredMessage[]> = new Map();

/** How many messages to retain per connection/topic before dropping the oldest. */
export const MAX_MESSAGES_PER_TOPIC = new InjectionToken<number>(
  "MAX_MESSAGES_PER_TOPIC",
  { providedIn: "root", factory: () => DEFAULT_MAX_MESSAGES_PER_TOPIC },
);

type TopicHistory = ReadonlyMap<string, readonly StoredMessage[]>;
type StoreState = ReadonlyMap<string, TopicHistory>;
type RetainedState = ReadonlyMap<string, ReadonlySet<string>>;

const EMPTY_RETAINED: ReadonlySet<string> = new Set();

/**
 * Session-only, in-memory history of received MQTT messages, keyed by
 * connection then topic. Not persisted - it only lives as long as the app.
 */
@Injectable({ providedIn: "root" })
export class MessageStoreService {
  private readonly maxMessagesPerTopic = inject(MAX_MESSAGES_PER_TOPIC);
  private readonly logger = inject(LoggerService);
  private readonly state$ = new BehaviorSubject<StoreState>(new Map());

  /** Topics known to hold a retained message on the broker.
   *
   * Necessarily incomplete: a broker only sets the retain flag on delivery
   * when the message is being sent *because* it was stored, i.e. to a
   * freshly-established subscription (MQTT 3.1.1 s3.3.1.3). A message
   * published while you were already subscribed arrives with the flag clear,
   * so this knows about a topic only if you subscribed to it after the
   * retained message was published. Treat a mark as "definitely retained",
   * and its absence as "not known to be", never as "definitely not".
   */
  private readonly retained$ = new BehaviorSubject<RetainedState>(new Map());

  constructor() {
    inject(MqttEventsService).events$.subscribe({
      next: (event) => {
        if ("MessageReceived" in event) {
          this.append(event.MessageReceived);
        }
      },
      // If the event stream itself errors (e.g. no Tauri IPC bridge available,
      // such as running outside the Tauri webview), there's nothing to recover
      // into - just stop appending. Without this, RxJS rethrows an unhandled
      // subscribe error as an uncaught exception.
      error: () => undefined,
    });
  }

  messagesFor(
    connectionId: string,
    topic: string,
  ): Observable<readonly StoredMessage[]> {
    return this.state$.pipe(
      map((state) => state.get(connectionId)?.get(topic) ?? EMPTY_MESSAGES),
      distinctUntilChanged(),
    );
  }

  topicsFor(connectionId: string): Observable<TopicHistory> {
    return this.state$.pipe(
      map((state) => state.get(connectionId) ?? EMPTY_TOPICS),
      distinctUntilChanged(),
    );
  }

  get snapshot$(): Observable<StoreState> {
    return this.state$.asObservable();
  }

  retainedTopicsFor(connectionId: string): Observable<ReadonlySet<string>> {
    return this.retained$.pipe(
      map((state) => state.get(connectionId) ?? EMPTY_RETAINED),
      distinctUntilChanged(),
    );
  }

  /** Forgets that a topic holds a retained message - for after clearing it
   * on the broker, since the zero-length publish that does the clearing
   * comes back as ordinary traffic with the retain flag unset. */
  forgetRetained(connectionId: string, topic: string): void {
    this.updateRetained(connectionId, topic, false);
  }

  clear(connectionId?: string): void {
    if (connectionId === undefined) {
      this.state$.next(new Map());
      this.retained$.next(new Map());
      return;
    }
    const next = new Map(this.state$.value);
    next.delete(connectionId);
    this.state$.next(next);

    const nextRetained = new Map(this.retained$.value);
    nextRetained.delete(connectionId);
    this.retained$.next(nextRetained);
  }

  /** Drops one topic's history, leaving the rest of the connection alone.
   * The topic disappears from `topicsFor` too, so the tree row goes with it -
   * it only exists because messages arrived on it.
   *
   * Deliberately keeps the retained mark: this only forgets what we saw
   * locally, and the broker still holds whatever it was holding. */
  clearTopic(connectionId: string, topic: string): void {
    const connectionHistory = this.state$.value.get(connectionId);
    if (connectionHistory === undefined || !connectionHistory.has(topic)) {
      return;
    }

    const updatedConnectionHistory = new Map(connectionHistory);
    updatedConnectionHistory.delete(topic);

    const updatedState = new Map(this.state$.value);
    updatedState.set(connectionId, updatedConnectionHistory);
    this.state$.next(updatedState);
  }

  private append(message: MqttMessageReceived): void {
    if (message.retain) {
      // A zero-length retained message is how MQTT deletes a retained value,
      // so an arriving one means the topic no longer holds anything. Read off
      // the *wire* length rather than what survived the IPC cap, which is what
      // tells a cleared topic apart from a message that arrived truncated.
      this.updateRetained(
        message.connection_id,
        message.topic,
        message.payload_len > 0,
      );
    }

    const state = this.state$.value;
    const connectionHistory = state.get(message.connection_id) ?? new Map();
    const topicHistory = connectionHistory.get(message.topic) ?? [];

    const updatedTopicHistory = [
      ...topicHistory,
      {
        payload: message.payload,
        payloadLen: message.payload_len,
        qos: message.qos,
        retain: message.retain,
        receivedAt: Date.now(),
      },
    ].slice(-this.maxMessagesPerTopic);

    const updatedConnectionHistory = new Map(connectionHistory);
    updatedConnectionHistory.set(message.topic, updatedTopicHistory);

    const updatedState = new Map(state);
    updatedState.set(message.connection_id, updatedConnectionHistory);

    this.logger.debug(
      `message store: connection=${message.connection_id} topic=${message.topic} payload_len=${message.payload_len} received_bytes=${message.payload.length} topic_count=${updatedTopicHistory.length}`,
    );

    this.state$.next(updatedState);
  }

  private updateRetained(
    connectionId: string,
    topic: string,
    isRetained: boolean,
  ): void {
    const topics = this.retained$.value.get(connectionId) ?? EMPTY_RETAINED;
    if (topics.has(topic) === isRetained) {
      return;
    }

    const updatedTopics = new Set(topics);
    if (isRetained) {
      updatedTopics.add(topic);
    } else {
      updatedTopics.delete(topic);
    }

    const updated = new Map(this.retained$.value);
    updated.set(connectionId, updatedTopics);
    this.retained$.next(updated);
  }
}
