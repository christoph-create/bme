import { BrokerConnection } from "../app/core/models/broker-connection.model";
import { FavoriteCollection } from "../app/core/models/favorite-collection.model";
import { FavoriteMessage } from "../app/core/models/favorite-message.model";
import { PayloadVariable } from "../app/core/models/payload-variable.model";
import { QoS } from "../app/core/models/qos";

/**
 * The example data every screenshot is staged from - one place to edit when a
 * feature needs something new on screen, rather than whatever happened to be
 * in the author's database on the day. Typed against the real models, so a
 * change to `core/src/models.rs` and its TypeScript mirror breaks the build
 * here instead of quietly producing a screenshot of the wrong shape.
 *
 * Ids are fixed rather than generated: the capture script navigates to
 * `/broker/<id>` by hand, and stable ids also keep re-runs byte-identical.
 */

export const DEMO_APP_VERSION = "0.7.0";

export const HOME_CONNECTION_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCTION_CONNECTION_ID = "22222222-2222-4222-8222-222222222222";
const OFFICE_CONNECTION_ID = "33333333-3333-4333-8333-333333333333";
const STAGING_CONNECTION_ID = "55555555-5555-4555-8555-555555555555";
const LOCAL_CONNECTION_ID = "66666666-6666-4666-8666-666666666666";

const SENSORS_COLLECTION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTUATORS_COLLECTION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** The topic the workspace shots open, and the one the charts read from.
 * Deliberately not named `temperature`: the tree shows only a topic's last
 * segment, and the capture script has to be able to click this one row
 * unambiguously. */
export const DEMO_SELECTED_TOPIC = "home/livingroom/climate";

export const DEMO_CONNECTIONS: readonly BrokerConnection[] = [
  {
    id: HOME_CONNECTION_ID,
    name: "Home Assistant",
    host: "homeassistant.local",
    port: 1883,
    client_id: "bme-desktop",
    username: null,
    password: null,
    use_tls: false,
    keep_alive_secs: 60,
    auto_reconnect: true,
    max_reconnect_attempts: 10,
    subscriptions: [
      {
        id: "44444444-4444-4444-8444-444444444441",
        connection_id: HOME_CONNECTION_ID,
        topic: "home/#",
        qos: "AtLeastOnce",
      },
      {
        id: "44444444-4444-4444-8444-444444444442",
        connection_id: HOME_CONNECTION_ID,
        topic: "sensors/+/status",
        qos: "AtMostOnce",
      },
    ],
  },
  {
    id: PRODUCTION_CONNECTION_ID,
    name: "Production Broker",
    host: "mqtt.example.com",
    port: 8883,
    client_id: "bme-desktop",
    username: "bme",
    password: "hunter2",
    use_tls: true,
    keep_alive_secs: 30,
    auto_reconnect: true,
    max_reconnect_attempts: 10,
    subscriptions: [],
  },
  {
    id: OFFICE_CONNECTION_ID,
    name: "Office Sensors",
    host: "192.168.1.42",
    port: 1883,
    client_id: "bme-office",
    username: null,
    password: null,
    use_tls: false,
    keep_alive_secs: 60,
    auto_reconnect: false,
    max_reconnect_attempts: 10,
    subscriptions: [],
  },
  {
    id: STAGING_CONNECTION_ID,
    name: "Staging Broker",
    host: "staging.example.com",
    port: 8883,
    client_id: "bme-desktop",
    username: "bme",
    password: "hunter2",
    use_tls: true,
    keep_alive_secs: 30,
    auto_reconnect: true,
    max_reconnect_attempts: 10,
    subscriptions: [],
  },
  {
    id: LOCAL_CONNECTION_ID,
    name: "Local Mosquitto",
    host: "localhost",
    port: 1883,
    client_id: "bme-local",
    username: null,
    password: null,
    use_tls: false,
    keep_alive_secs: 60,
    auto_reconnect: true,
    max_reconnect_attempts: 10,
    subscriptions: [],
  },
];

export const DEMO_COLLECTIONS: readonly FavoriteCollection[] = [
  {
    id: SENSORS_COLLECTION_ID,
    name: "Sensors",
    description: "Readings and status payloads for the zone-a rig",
    created_at: "2026-07-02T09:12:00Z",
  },
  {
    id: ACTUATORS_COLLECTION_ID,
    name: "Actuators",
    description: "Commands for relays and lights",
    created_at: "2026-07-02T09:18:00Z",
  },
];

/** Newest first - `list_favorites` orders by `created_at DESC`, and the demo
 * backend hands the array back as-is. */
export const DEMO_TEMPLATES: readonly FavoriteMessage[] = [
  {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccc01",
    collection_id: SENSORS_COLLECTION_ID,
    name: "Temperature reading",
    description: "A single room temperature sample with its battery level.",
    topic: "sensors/zone-a/temperature",
    payload: '{"value": 21.4, "unit": "C", "battery": 92}',
    format: "json",
    qos: "AtLeastOnce",
    retain: false,
    created_at: "2026-07-14T08:05:00Z",
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccc02",
    collection_id: SENSORS_COLLECTION_ID,
    name: "Humidity reading",
    description: "Relative humidity, same shape as the temperature sample.",
    topic: "sensors/zone-a/humidity",
    payload: '{"value": 47, "unit": "%"}',
    format: "json",
    qos: "AtMostOnce",
    retain: false,
    created_at: "2026-07-14T08:04:00Z",
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccc03",
    collection_id: SENSORS_COLLECTION_ID,
    name: "Sensor heartbeat",
    description: "Retained status message, stamped with the {{isoDate}} variable.",
    topic: "sensors/zone-a/status",
    payload: '{"online": true, "uptime": 86400, "seen": "{{isoDate}}"}',
    format: "json",
    qos: "AtLeastOnce",
    retain: true,
    created_at: "2026-07-14T08:03:00Z",
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccc04",
    collection_id: ACTUATORS_COLLECTION_ID,
    name: "Relay on",
    description: "Plain text command, no JSON wrapper.",
    topic: "actuators/zone-a/relay-1/set",
    payload: "ON",
    format: "raw",
    qos: "AtLeastOnce",
    retain: false,
    created_at: "2026-07-14T08:02:00Z",
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccc05",
    collection_id: ACTUATORS_COLLECTION_ID,
    name: "Dim hallway light",
    description: "Sets brightness as well as state.",
    topic: "actuators/hallway/light/set",
    payload: '{"state": "ON", "brightness": 128}',
    format: "json",
    qos: "AtMostOnce",
    retain: false,
    created_at: "2026-07-14T08:01:00Z",
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccc06",
    collection_id: null,
    name: "Discovery ping",
    description: null,
    topic: "devices/{{deviceId}}/ping",
    payload: '{"id": "{{uuid}}", "seq": {{counter}}}',
    format: "json",
    qos: "AtMostOnce",
    retain: false,
    created_at: "2026-07-14T08:00:00Z",
  },
];

/** The four seeded by migration `0010_payload_variables.sql`, plus two the
 * user would plausibly have added - enough for the variables modal to show
 * more than one generator type. */
export const DEMO_VARIABLES: readonly PayloadVariable[] = [
  {
    id: "0195b1a0-7c41-4e2a-9f01-000000000001",
    name: "uuid",
    generator: { kind: "uuid" },
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "0195b1a0-7c41-4e2a-9f01-000000000002",
    name: "timestamp",
    generator: { kind: "timestamp", format: "unixMillis" },
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "0195b1a0-7c41-4e2a-9f01-000000000003",
    name: "isoDate",
    generator: { kind: "timestamp", format: "iso8601" },
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "0195b1a0-7c41-4e2a-9f01-000000000004",
    name: "counter",
    generator: { kind: "counter", start: 1, step: 1 },
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "0195b1a0-7c41-4e2a-9f01-000000000005",
    name: "deviceId",
    generator: { kind: "fixedText", value: "zone-a-01" },
    created_at: "2026-07-14T10:00:00Z",
  },
  {
    id: "0195b1a0-7c41-4e2a-9f01-000000000006",
    name: "tempC",
    generator: { kind: "randomFloat", min: 18, max: 24, decimals: 1 },
    created_at: "2026-07-14T10:01:00Z",
  },
];

/** One received message, plus how far the demo clock advances before it
 * arrives. The gaps are what give the stream its "12s ago / 24s ago" ladder,
 * so they are data rather than real waiting - see `demo-clock.ts`. */
export interface DemoMessage {
  topic: string;
  /** Text payload; encoded to bytes when emitted, like the real backend. */
  payload: string;
  qos: QoS;
  retain: boolean;
  gapMs: number;
}

function reading(
  topic: string,
  payload: string,
  gapMs: number,
  qos: QoS = "AtLeastOnce",
): DemoMessage {
  return { topic, payload, qos, retain: false, gapMs };
}

/**
 * Played in order by `__bmeDemo.playTimeline()`. Two things depend on the
 * exact contents: the topic tree's shape (one row per distinct topic, folders
 * from the `/` segments) and the value charts, which can only offer fields
 * they have seen numeric values for on the selected topic.
 */
export const DEMO_TIMELINE: readonly DemoMessage[] = [
  // Retained messages first - a real session receives them the moment the
  // subscription is established, which is also what marks them "R" in the tree.
  {
    topic: "home/hallway/light",
    payload: '{"state": "OFF", "brightness": 0}',
    qos: "AtLeastOnce",
    retain: true,
    gapMs: 0,
  },
  {
    topic: "sensors/zone-a/status",
    payload: '{"online": true, "uptime": 86400}',
    qos: "AtMostOnce",
    retain: true,
    gapMs: 400,
  },

  reading("home/kitchen/temperature", '{"temperature": 19.8, "humidity": 51}', 2_600),
  reading("home/bedroom/temperature", '{"temperature": 18.9, "humidity": 55}', 1_800),
  reading("home/kitchen/motion", '{"motion": false, "lux": 143}', 2_200, "AtMostOnce"),

  reading(
    DEMO_SELECTED_TOPIC,
    '{"temperature": 21.9, "humidity": 46, "battery": 93}',
    3_000,
  ),
  reading("home/hallway/light", '{"state": "ON", "brightness": 180}', 4_100),
  reading(
    DEMO_SELECTED_TOPIC,
    '{"temperature": 21.7, "humidity": 46, "battery": 93}',
    5_000,
  ),
  reading("home/bedroom/temperature", '{"temperature": 19.1, "humidity": 54}', 2_400),
  reading(
    DEMO_SELECTED_TOPIC,
    '{"temperature": 21.6, "humidity": 47, "battery": 92}',
    4_600,
  ),
  reading("home/kitchen/temperature", '{"temperature": 20.1, "humidity": 50}', 3_300),
  reading(
    DEMO_SELECTED_TOPIC,
    '{"temperature": 21.4, "humidity": 47, "battery": 92}',
    5_200,
  ),
  reading("home/kitchen/motion", '{"motion": true, "lux": 96}', 2_800, "AtMostOnce"),
  reading(
    DEMO_SELECTED_TOPIC,
    '{"temperature": 21.3, "humidity": 48, "battery": 92}',
    4_800,
  ),
  reading(
    DEMO_SELECTED_TOPIC,
    '{"temperature": 21.5, "humidity": 48, "battery": 92}',
    6_100,
  ),
];

/** Templates the capture script loads into the publish panel. The payload
 * editor is a CodeMirror instance, so driving it through the app's own "Load
 * Template" flow is both more robust than synthetic typing and a truer
 * representation of how the panel gets filled. */
export const DEMO_DRAFT_TEMPLATE_NAME = "Temperature reading";
export const DEMO_VARIABLE_TEMPLATE_NAME = "Discovery ping";
