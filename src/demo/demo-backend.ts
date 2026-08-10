import { InvokeArgs } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";

import {
  BrokerConnection,
  NewBrokerConnection,
  Subscription,
  UpdateBrokerConnection,
} from "../app/core/models/broker-connection.model";
import {
  FavoriteCollection,
  NewFavoriteCollection,
  UpdateFavoriteCollection,
} from "../app/core/models/favorite-collection.model";
import {
  FavoriteMessage,
  NewFavoriteMessage,
  UpdateFavoriteMessage,
} from "../app/core/models/favorite-message.model";
import { MqttEvent } from "../app/core/models/mqtt-event.model";
import {
  NewPayloadVariable,
  PayloadVariable,
  UpdatePayloadVariable,
} from "../app/core/models/payload-variable.model";
import { QoS } from "../app/core/models/qos";
import { UpdateCheck } from "../app/core/models/update-check.model";
import { advanceDemoClock, installDemoClock } from "./demo-clock";
import {
  DEMO_APP_VERSION,
  DEMO_COLLECTIONS,
  DEMO_CONNECTIONS,
  DEMO_TEMPLATES,
  DEMO_TIMELINE,
  DEMO_VARIABLES,
} from "./demo-data";

/**
 * A stand-in for the Rust backend, good enough to run the whole UI in a plain
 * browser: `mockIPC` intercepts every `invoke()` and, with `shouldMockEvents`,
 * routes `emit`/`listen` through an in-page registry so `"mqtt-event"` works
 * too. Exists so screenshots can be captured deterministically, with no
 * broker, no database and no display server - see `scripts/screenshots.mjs`.
 *
 * State starts as a copy of `demo-data.ts` and is mutable, so the flows a
 * screenshot has to walk through (saving a template, adding a subscription)
 * behave the way they do in the real app rather than silently no-op'ing.
 */

/** How long the mock waits before confirming a connect. The workspace
 * subscribes to `"mqtt-event"` in its constructor and `listen()` resolves
 * asynchronously, so an immediately-emitted `Connected` would arrive before
 * anyone is listening and leave the header stuck on "Connecting…". */
const CONNECT_LATENCY_MS = 50;

/** Trailing gap after the last timeline message, so the newest card reads as
 * seconds old rather than "just now". */
const DEFAULT_SETTLE_MS = 9_000;

interface DemoApi {
  /** Marks the connection connected, as a real broker handshake would. */
  connect(connectionId: string): Promise<void>;
  /** Replays `DEMO_TIMELINE` into the message store, advancing the demo clock
   * by each message's `gapMs` so the relative timestamps come out stable. */
  playTimeline(connectionId: string, settleMs?: number): Promise<void>;
  advanceClock(ms: number): void;
}

declare global {
  interface Window {
    __bmeDemo: DemoApi;
  }
}

/** Real IPC serializes everything that crosses it, so the frontend can never
 * hold a reference into backend state. Cloning on the way out keeps that
 * true here - without it, a component mutating a list it was handed would
 * quietly rewrite the fixture. */
function clone<T>(value: T): T {
  return structuredClone(value);
}

function cloneAll<T>(values: readonly T[]): T[] {
  return values.map(clone);
}

function arg<T>(args: InvokeArgs | undefined, key: string): T {
  return (args as Record<string, unknown> | undefined)?.[key] as T;
}

/** Deterministic stand-in for the ids SQLite would hand out. Real UUIDs would
 * make every capture run differ. */
let generatedIds = 0;
function nextId(): string {
  generatedIds += 1;
  return `dddddddd-dddd-4ddd-8ddd-${String(generatedIds).padStart(12, "0")}`;
}

const NOW_ISO = "2026-07-19T09:30:00Z";

class DemoState {
  readonly connections = cloneAll(DEMO_CONNECTIONS);
  readonly collections = cloneAll(DEMO_COLLECTIONS);
  readonly templates = cloneAll(DEMO_TEMPLATES);
  readonly variables = cloneAll(DEMO_VARIABLES);

  connection(id: string): BrokerConnection | null {
    return this.connections.find((c) => c.id === id) ?? null;
  }

  createConnection(input: NewBrokerConnection): BrokerConnection {
    const id = nextId();
    const created: BrokerConnection = {
      ...input,
      id,
      subscriptions: input.subscriptions.map((subscription) => ({
        ...subscription,
        id: nextId(),
        connection_id: id,
      })),
    };
    this.connections.push(created);
    return created;
  }

  updateConnection(
    id: string,
    update: UpdateBrokerConnection,
  ): BrokerConnection {
    const existing = this.connection(id);
    if (existing === null) {
      throw new Error(`unknown connection ${id}`);
    }
    Object.assign(existing, update);
    return existing;
  }

  createFavorite(input: NewFavoriteMessage): FavoriteMessage {
    const created: FavoriteMessage = {
      ...input,
      id: nextId(),
      created_at: NOW_ISO,
    };
    // Newest first, matching `list_favorites`' `created_at DESC` ordering.
    this.templates.unshift(created);
    return created;
  }

  createCollection(input: NewFavoriteCollection): FavoriteCollection {
    const created: FavoriteCollection = {
      ...input,
      id: nextId(),
      created_at: NOW_ISO,
    };
    this.collections.push(created);
    return created;
  }

  createVariable(input: NewPayloadVariable): PayloadVariable {
    const created: PayloadVariable = {
      ...input,
      id: nextId(),
      created_at: NOW_ISO,
    };
    this.variables.push(created);
    return created;
  }
}

function removeById<T extends { id: string }>(items: T[], id: string): void {
  const index = items.findIndex((item) => item.id === id);
  if (index !== -1) {
    items.splice(index, 1);
  }
}

function replaceById<T extends { id: string }>(
  items: T[],
  id: string,
  update: object,
): T {
  const existing = items.find((item) => item.id === id);
  if (existing === undefined) {
    throw new Error(`unknown id ${id}`);
  }
  Object.assign(existing, update);
  return existing;
}

function emitMqtt(event: MqttEvent): Promise<void> {
  return emit("mqtt-event", event);
}

function encodePayload(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

export function installDemoBackend(): void {
  installDemoClock();
  const state = new DemoState();

  mockIPC((cmd, args) => {
    switch (cmd) {
      // Fire-and-forget side effects the UI never reads back.
      case "plugin:log|log":
      case "plugin:opener|open_url":
      case "open_log_dir":
      case "skip_update_version":
        return null;

      case "get_app_version":
        return DEMO_APP_VERSION;

      case "check_for_updates":
        // Always up to date: the notifier runs an automatic check three
        // seconds after launch, and a dialog appearing mid-capture would
        // land in whichever screenshot happened to be in progress.
        return {
          current_version: DEMO_APP_VERSION,
          latest: null,
          throttled: false,
        } satisfies UpdateCheck;

      case "list_connections":
        return cloneAll(state.connections);
      case "get_connection":
        return clone(state.connection(arg<string>(args, "id")));
      case "create_connection":
        return clone(
          state.createConnection(arg<NewBrokerConnection>(args, "newConnection")),
        );
      case "update_connection":
        return clone(
          state.updateConnection(
            arg<string>(args, "id"),
            arg<UpdateBrokerConnection>(args, "update"),
          ),
        );
      case "delete_connection":
        removeById(state.connections, arg<string>(args, "id"));
        return null;

      case "connect_broker": {
        const id = arg<string>(args, "id");
        setTimeout(
          () => void emitMqtt({ Connected: { connection_id: id } }),
          CONNECT_LATENCY_MS,
        );
        return null;
      }
      case "disconnect_broker": {
        const id = arg<string>(args, "id");
        setTimeout(
          () => void emitMqtt({ Disconnected: { connection_id: id } }),
          CONNECT_LATENCY_MS,
        );
        return null;
      }
      case "test_connection":
        return nextId();

      case "publish_message": {
        // Echoed straight back, which is what a broker that has us subscribed
        // to our own publish topic would do - it keeps the stream alive when
        // the app is driven by hand.
        const event: MqttEvent = {
          MessageReceived: {
            connection_id: arg<string>(args, "connectionId"),
            topic: arg<string>(args, "topic"),
            payload: arg<number[]>(args, "payload"),
            qos: arg<QoS>(args, "qos"),
            retain: arg<boolean>(args, "retain"),
          },
        };
        setTimeout(() => void emitMqtt(event), 0);
        return null;
      }
      case "subscribe_topic": {
        const connectionId = arg<string>(args, "connectionId");
        const subscription: Subscription = {
          id: nextId(),
          connection_id: connectionId,
          topic: arg<string>(args, "topic"),
          qos: arg<QoS>(args, "qos"),
        };
        state.connection(connectionId)?.subscriptions.push(subscription);
        return clone(subscription);
      }
      case "unsubscribe_topic": {
        const connection = state.connection(arg<string>(args, "connectionId"));
        if (connection) {
          removeById(
            connection.subscriptions,
            arg<string>(args, "subscriptionId"),
          );
        }
        return null;
      }

      case "list_favorites":
        return cloneAll(state.templates);
      case "get_favorite":
        return clone(
          state.templates.find((t) => t.id === arg<string>(args, "id")) ?? null,
        );
      case "create_favorite":
        return clone(
          state.createFavorite(arg<NewFavoriteMessage>(args, "newFavorite")),
        );
      case "update_favorite":
        return clone(
          replaceById(
            state.templates,
            arg<string>(args, "id"),
            arg<UpdateFavoriteMessage>(args, "update"),
          ),
        );
      case "delete_favorite":
        removeById(state.templates, arg<string>(args, "id"));
        return null;

      case "list_favorite_collections":
        return cloneAll(state.collections);
      case "get_favorite_collection":
        return clone(
          state.collections.find((c) => c.id === arg<string>(args, "id")) ?? null,
        );
      case "create_favorite_collection":
        return clone(
          state.createCollection(
            arg<NewFavoriteCollection>(args, "newCollection"),
          ),
        );
      case "update_favorite_collection":
        return clone(
          replaceById(
            state.collections,
            arg<string>(args, "id"),
            arg<UpdateFavoriteCollection>(args, "update"),
          ),
        );
      case "delete_favorite_collection":
        removeById(state.collections, arg<string>(args, "id"));
        return null;

      case "list_payload_variables":
        return cloneAll(state.variables);
      case "get_payload_variable":
        return clone(
          state.variables.find((v) => v.id === arg<string>(args, "id")) ?? null,
        );
      case "create_payload_variable":
        return clone(
          state.createVariable(arg<NewPayloadVariable>(args, "newVariable")),
        );
      case "update_payload_variable":
        return clone(
          replaceById(
            state.variables,
            arg<string>(args, "id"),
            arg<UpdatePayloadVariable>(args, "update"),
          ),
        );
      case "delete_payload_variable":
        removeById(state.variables, arg<string>(args, "id"));
        return null;

      default:
        throw new Error(`demo backend: unhandled command "${cmd}"`);
    }
  }, { shouldMockEvents: true });

  window.__bmeDemo = {
    async connect(connectionId: string): Promise<void> {
      await emitMqtt({ Connected: { connection_id: connectionId } });
    },

    async playTimeline(
      connectionId: string,
      settleMs = DEFAULT_SETTLE_MS,
    ): Promise<void> {
      for (const message of DEMO_TIMELINE) {
        advanceDemoClock(message.gapMs);
        await emitMqtt({
          MessageReceived: {
            connection_id: connectionId,
            topic: message.topic,
            payload: encodePayload(message.payload),
            qos: message.qos,
            retain: message.retain,
          },
        });
      }
      advanceDemoClock(settleMs);
    },

    advanceClock(ms: number): void {
      advanceDemoClock(ms);
    },
  };
}
