import { Injectable, InjectionToken, inject } from "@angular/core";
import { BehaviorSubject, Observable, distinctUntilChanged, map } from "rxjs";

import { StoredMessage } from "../models/stored-message.model";
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

/**
 * Session-only, in-memory history of received MQTT messages, keyed by
 * connection then topic. Not persisted - it only lives as long as the app.
 */
@Injectable({ providedIn: "root" })
export class MessageStoreService {
  private readonly maxMessagesPerTopic = inject(MAX_MESSAGES_PER_TOPIC);
  private readonly state$ = new BehaviorSubject<StoreState>(new Map());

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

  clear(connectionId?: string): void {
    if (connectionId === undefined) {
      this.state$.next(new Map());
      return;
    }
    const next = new Map(this.state$.value);
    next.delete(connectionId);
    this.state$.next(next);
  }

  private append(message: {
    connection_id: string;
    topic: string;
    payload: number[];
    qos: StoredMessage["qos"];
    retain: boolean;
  }): void {
    const state = this.state$.value;
    const connectionHistory = state.get(message.connection_id) ?? new Map();
    const topicHistory = connectionHistory.get(message.topic) ?? [];

    const updatedTopicHistory = [
      ...topicHistory,
      {
        payload: message.payload,
        qos: message.qos,
        retain: message.retain,
        receivedAt: Date.now(),
      },
    ].slice(-this.maxMessagesPerTopic);

    const updatedConnectionHistory = new Map(connectionHistory);
    updatedConnectionHistory.set(message.topic, updatedTopicHistory);

    const updatedState = new Map(state);
    updatedState.set(message.connection_id, updatedConnectionHistory);

    this.state$.next(updatedState);
  }
}
