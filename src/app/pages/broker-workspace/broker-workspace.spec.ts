import { TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import {
  ActivatedRoute,
  Router,
  convertToParamMap,
  provideRouter,
} from "@angular/router";
import { Subject, of } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrokerConnection } from "../../core/models/broker-connection.model";
import { MqttEvent } from "../../core/models/mqtt-event.model";
import { ConnectionsService } from "../../core/services/connections.service";
import { MessageStoreService } from "../../core/services/message-store.service";
import { MqttEventsService } from "../../core/services/mqtt-events.service";
import { BrokerWorkspace } from "./broker-workspace";
import { MessageStream } from "./message-stream/message-stream";
import { PublishPanel } from "./publish-panel/publish-panel";
import { TopicTree } from "./topic-tree/topic-tree";

const CONNECTION_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_CONNECTION_ID = "22222222-2222-2222-2222-222222222222";

function sampleConnection(
  overrides: Partial<BrokerConnection> = {},
): BrokerConnection {
  return {
    id: CONNECTION_ID,
    name: "Home Assistant",
    host: "homeassistant.local",
    port: 1883,
    client_id: "bme",
    username: null,
    password: null,
    use_tls: false,
    keep_alive_secs: 30,
    auto_reconnect: true,
    max_reconnect_attempts: 10,
    subscriptions: [],
    ...overrides,
  };
}

function pointerEvent(x: number, y: number): PointerEvent {
  return {
    clientX: x,
    clientY: y,
    preventDefault: vi.fn(),
  } as unknown as PointerEvent;
}

async function setup(
  options: {
    connect?: ReturnType<typeof vi.fn>;
    disconnect?: ReturnType<typeof vi.fn>;
    get?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const connect = options.connect ?? vi.fn().mockResolvedValue(undefined);
  const disconnect =
    options.disconnect ?? vi.fn().mockResolvedValue(undefined);
  const get = options.get ?? vi.fn().mockResolvedValue(null);
  const events$ = new Subject<MqttEvent>();

  TestBed.configureTestingModule({
    imports: [BrokerWorkspace],
    providers: [
      provideRouter([]),
      { provide: ConnectionsService, useValue: { connect, disconnect, get } },
      {
        provide: MessageStoreService,
        useValue: {
          topicsFor: vi.fn().mockReturnValue(of(new Map())),
          retainedTopicsFor: vi.fn().mockReturnValue(of(new Set())),
          messagesFor: vi.fn().mockReturnValue(of([])),
        },
      },
      { provide: MqttEventsService, useValue: { events$ } },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { paramMap: convertToParamMap({ id: CONNECTION_ID }) },
        },
      },
    ],
  });

  const fixture = TestBed.createComponent(BrokerWorkspace);
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, "navigate").mockResolvedValue(true);
  fixture.detectChanges();

  return { fixture, connect, disconnect, navigate, events$ };
}

describe("BrokerWorkspace", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.innerWidth = 1024;
    window.innerHeight = 768;
  });

  it("should create", async () => {
    const { fixture } = await setup();
    await fixture.whenStable();

    expect(fixture.componentInstance).toBeTruthy();
  });

  it("exposes the connection id from the route", async () => {
    const { fixture } = await setup();
    await fixture.whenStable();

    expect(fixture.componentInstance.connectionId).toBe(CONNECTION_ID);
  });

  it("connects to the broker for the route's connection id on init", async () => {
    const { fixture, connect } = await setup();
    await fixture.whenStable();

    expect(connect).toHaveBeenCalledWith(CONNECTION_ID);
  });

  it("shows the connection's name and host:port in the header once loaded", async () => {
    const get = vi.fn().mockResolvedValue(sampleConnection());
    const { fixture } = await setup({ get });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(get).toHaveBeenCalledWith(CONNECTION_ID);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("Home Assistant");
    expect(text).toContain("homeassistant.local:1883");
  });

  it("falls back to a generic title before the connection has loaded", async () => {
    const { fixture } = await setup();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("Broker Workspace");
  });

  it("keeps showing the connecting indicator after the connect command is accepted, until the broker confirms", async () => {
    const { fixture, events$ } = await setup();
    await fixture.whenStable();

    // The connect() invoke call resolving only means the command was
    // accepted, not that a session exists yet - status must wait for the
    // Connected event.
    expect(fixture.componentInstance.connecting()).toBe(true);

    events$.next({ Connected: { connection_id: CONNECTION_ID } });
    fixture.detectChanges();

    expect(fixture.componentInstance.connecting()).toBe(false);
    expect(fixture.componentInstance.connectError()).toBeNull();
  });

  it("shows an error when the initial connect command itself is rejected", async () => {
    const connect = vi.fn().mockRejectedValue(new Error("broker unreachable"));

    const { fixture } = await setup({ connect });
    await fixture.whenStable();

    expect(fixture.componentInstance.connecting()).toBe(false);
    expect(fixture.componentInstance.connectError()).toBe(
      "broker unreachable",
    );
  });

  it("stops connecting and surfaces an error when the broker reports it disconnected", async () => {
    const { fixture, events$ } = await setup();
    await fixture.whenStable();

    events$.next({ Disconnected: { connection_id: CONNECTION_ID } });
    fixture.detectChanges();

    expect(fixture.componentInstance.connecting()).toBe(false);
    expect(fixture.componentInstance.connectError()).toBe(
      "Disconnected from broker",
    );
  });

  it("flips from connected back to an error if the broker drops the session later", async () => {
    const { fixture, events$ } = await setup();
    await fixture.whenStable();

    events$.next({ Connected: { connection_id: CONNECTION_ID } });
    fixture.detectChanges();
    expect(fixture.componentInstance.connecting()).toBe(false);
    expect(fixture.componentInstance.connectError()).toBeNull();

    events$.next({ Disconnected: { connection_id: CONNECTION_ID } });
    fixture.detectChanges();

    expect(fixture.componentInstance.connectError()).toBe(
      "Disconnected from broker",
    );
  });

  it("computes connected as false while still connecting", async () => {
    const { fixture } = await setup();
    await fixture.whenStable();

    expect(fixture.componentInstance.connected()).toBe(false);
  });

  it("computes connected as true once the Connected event arrives", async () => {
    const { fixture, events$ } = await setup();
    await fixture.whenStable();

    events$.next({ Connected: { connection_id: CONNECTION_ID } });
    fixture.detectChanges();

    expect(fixture.componentInstance.connected()).toBe(true);
  });

  it("computes connected as false again if the broker reports Disconnected", async () => {
    const { fixture, events$ } = await setup();
    await fixture.whenStable();

    events$.next({ Connected: { connection_id: CONNECTION_ID } });
    fixture.detectChanges();
    expect(fixture.componentInstance.connected()).toBe(true);

    events$.next({ Disconnected: { connection_id: CONNECTION_ID } });
    fixture.detectChanges();

    expect(fixture.componentInstance.connected()).toBe(false);
  });

  it("ignores Connected/Disconnected events for other connections", async () => {
    const { fixture, events$ } = await setup();
    await fixture.whenStable();

    events$.next({ Disconnected: { connection_id: OTHER_CONNECTION_ID } });
    fixture.detectChanges();

    expect(fixture.componentInstance.connecting()).toBe(true);
    expect(fixture.componentInstance.connectError()).toBeNull();
  });

  it("shows the reconnect state instead of an error while the backend is retrying", async () => {
    const { fixture, events$ } = await setup();
    await fixture.whenStable();

    events$.next({ Connected: { connection_id: CONNECTION_ID } });
    fixture.detectChanges();

    events$.next({
      Reconnecting: {
        connection_id: CONNECTION_ID,
        attempt: 3,
        max_attempts: 10,
        delay_ms: 4000,
      },
    });
    fixture.detectChanges();

    expect(fixture.componentInstance.reconnecting()).toEqual({
      attempt: 3,
      maxAttempts: 10,
    });
    expect(fixture.componentInstance.connectError()).toBeNull();
    expect(fixture.componentInstance.connecting()).toBe(false);
  });

  it("renders the reconnect banner with a spinner, the attempt count and a Stop button", async () => {
    const { fixture, events$ } = await setup();
    await fixture.whenStable();

    events$.next({
      Reconnecting: {
        connection_id: CONNECTION_ID,
        attempt: 3,
        max_attempts: 10,
        delay_ms: 4000,
      },
    });
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const banner = element.querySelector(".reconnect-banner");
    expect(banner).not.toBeNull();
    expect(banner?.querySelector(".spinner")).not.toBeNull();
    expect(banner?.textContent).toContain("Reconnecting… (attempt 3 of 10)");
    expect(banner?.querySelector("button")?.textContent?.trim()).toBe("Stop");
    // The red banner is the give-up state and must not be showing as well.
    expect(element.querySelector(".connect-error-banner")).toBeNull();
  });

  it("counts reconnecting as not connected, so publishing stays disabled", async () => {
    const { fixture, events$ } = await setup();
    await fixture.whenStable();

    events$.next({ Connected: { connection_id: CONNECTION_ID } });
    fixture.detectChanges();
    expect(fixture.componentInstance.connected()).toBe(true);

    events$.next({
      Reconnecting: {
        connection_id: CONNECTION_ID,
        attempt: 1,
        max_attempts: 10,
        delay_ms: 1000,
      },
    });
    fixture.detectChanges();

    expect(fixture.componentInstance.connected()).toBe(false);
  });

  it("clears the reconnect state when the session comes back", async () => {
    const { fixture, events$ } = await setup();
    await fixture.whenStable();

    events$.next({
      Reconnecting: {
        connection_id: CONNECTION_ID,
        attempt: 2,
        max_attempts: 10,
        delay_ms: 2000,
      },
    });
    fixture.detectChanges();

    events$.next({ Connected: { connection_id: CONNECTION_ID } });
    fixture.detectChanges();

    expect(fixture.componentInstance.reconnecting()).toBeNull();
    expect(fixture.componentInstance.connected()).toBe(true);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(".reconnect-banner"),
    ).toBeNull();
  });

  it("falls back to the error banner when the backend runs out of attempts", async () => {
    const { fixture, events$ } = await setup();
    await fixture.whenStable();

    events$.next({
      Reconnecting: {
        connection_id: CONNECTION_ID,
        attempt: 10,
        max_attempts: 10,
        delay_ms: 30000,
      },
    });
    fixture.detectChanges();

    // The backend only sends Disconnected once it has stopped retrying.
    events$.next({ Disconnected: { connection_id: CONNECTION_ID } });
    fixture.detectChanges();

    expect(fixture.componentInstance.reconnecting()).toBeNull();
    expect(fixture.componentInstance.connectError()).toBe(
      "Disconnected from broker",
    );
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector(".reconnect-banner")).toBeNull();
    expect(element.querySelector(".connect-error-banner")).not.toBeNull();
  });

  it("ignores Reconnecting events for other connections", async () => {
    const { fixture, events$ } = await setup();
    await fixture.whenStable();

    events$.next({
      Reconnecting: {
        connection_id: OTHER_CONNECTION_ID,
        attempt: 1,
        max_attempts: 10,
        delay_ms: 1000,
      },
    });
    fixture.detectChanges();

    expect(fixture.componentInstance.reconnecting()).toBeNull();
    expect(fixture.componentInstance.connecting()).toBe(true);
  });

  it("stops reconnecting on request without leaving the workspace", async () => {
    const { fixture, events$, disconnect, navigate } = await setup();
    await fixture.whenStable();

    events$.next({
      Reconnecting: {
        connection_id: CONNECTION_ID,
        attempt: 2,
        max_attempts: 10,
        delay_ms: 2000,
      },
    });
    fixture.detectChanges();

    await fixture.componentInstance.stopReconnecting();
    fixture.detectChanges();

    expect(disconnect).toHaveBeenCalledWith(CONNECTION_ID);
    expect(navigate).not.toHaveBeenCalled();
    expect(fixture.componentInstance.reconnecting()).toBeNull();
    expect(fixture.componentInstance.connectError()).toBe(
      "Disconnected from broker",
    );
  });

  it("surfaces a failure to stop reconnecting rather than leaving the spinner running", async () => {
    const disconnect = vi.fn().mockRejectedValue(new Error("stop failed"));
    const { fixture, events$ } = await setup({ disconnect });
    await fixture.whenStable();

    events$.next({
      Reconnecting: {
        connection_id: CONNECTION_ID,
        attempt: 2,
        max_attempts: 10,
        delay_ms: 2000,
      },
    });
    fixture.detectChanges();

    await fixture.componentInstance.stopReconnecting();

    expect(fixture.componentInstance.reconnecting()).toBeNull();
    expect(fixture.componentInstance.connectError()).toBe("stop failed");
  });

  it("clears the reconnect state when connect() is retried", async () => {
    const { fixture, events$ } = await setup();
    await fixture.whenStable();

    events$.next({
      Reconnecting: {
        connection_id: CONNECTION_ID,
        attempt: 4,
        max_attempts: 10,
        delay_ms: 8000,
      },
    });
    fixture.detectChanges();

    await fixture.componentInstance.connect();

    expect(fixture.componentInstance.reconnecting()).toBeNull();
    expect(fixture.componentInstance.connecting()).toBe(true);
  });

  it("clears a previous error and reconnects when connect() is retried", async () => {
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error("broker unreachable"))
      .mockResolvedValueOnce(undefined);

    const { fixture } = await setup({ connect });
    await fixture.whenStable();
    expect(fixture.componentInstance.connectError()).toBe(
      "broker unreachable",
    );

    await fixture.componentInstance.connect();

    expect(fixture.componentInstance.connectError()).toBeNull();
    expect(fixture.componentInstance.connecting()).toBe(true);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("disconnects and navigates back to Connections", async () => {
    const { fixture, disconnect, navigate } = await setup();
    await fixture.whenStable();

    await fixture.componentInstance.disconnect();

    expect(disconnect).toHaveBeenCalledWith(CONNECTION_ID);
    expect(navigate).toHaveBeenCalledWith(["/connections"]);
  });

  it("surfaces an error and does not navigate if disconnect fails", async () => {
    const disconnect = vi.fn().mockRejectedValue(new Error("still busy"));
    const { fixture, navigate } = await setup({ disconnect });
    await fixture.whenStable();

    await fixture.componentInstance.disconnect();

    expect(fixture.componentInstance.connectError()).toBe("still busy");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("widens the sidebar as the column resizer is dragged right", async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    const component = fixture.componentInstance;

    const startWidth = component.sidebarWidth();
    component.startColumnResize(pointerEvent(200, 0));
    component.onPointerMove(pointerEvent(240, 0));

    expect(component.sidebarWidth()).toBe(startWidth + 40);
  });

  it("clamps the sidebar width to its minimum", async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    const component = fixture.componentInstance;

    component.startColumnResize(pointerEvent(200, 0));
    component.onPointerMove(pointerEvent(-5000, 0));

    expect(component.sidebarWidth()).toBe(200);
  });

  it("clamps the sidebar width to its maximum", async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    const component = fixture.componentInstance;

    component.startColumnResize(pointerEvent(200, 0));
    component.onPointerMove(pointerEvent(5000, 0));

    expect(component.sidebarWidth()).toBe(1200);
  });

  it("grows the publish panel when the row resizer is dragged up", async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    const component = fixture.componentInstance;

    const startHeight = component.publishHeight();
    component.startRowResize(pointerEvent(0, 300));
    component.onPointerMove(pointerEvent(0, 260));

    expect(component.publishHeight()).toBe(startHeight + 40);
  });

  it("clamps the publish height to its minimum", async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    const component = fixture.componentInstance;

    component.startRowResize(pointerEvent(0, 300));
    component.onPointerMove(pointerEvent(0, 5000));

    expect(component.publishHeight()).toBe(200);
  });

  it("clamps the publish height to its maximum", async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    const component = fixture.componentInstance;

    component.startRowResize(pointerEvent(0, 300));
    component.onPointerMove(pointerEvent(0, -5000));

    expect(component.publishHeight()).toBe(560);
  });

  it("stops resizing after pointerup", async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    const component = fixture.componentInstance;

    const startWidth = component.sidebarWidth();
    component.startColumnResize(pointerEvent(200, 0));
    component.onPointerUp();
    component.onPointerMove(pointerEvent(240, 0));

    expect(component.sidebarWidth()).toBe(startWidth);
  });

  it("scales the sidebar width proportionally when the window widens", async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    const component = fixture.componentInstance;

    const startWidth = component.sidebarWidth();
    window.innerWidth = 2048; // double the default 1024
    component.onWindowResize();

    expect(component.sidebarWidth()).toBe(startWidth * 2);
  });

  it("clamps the sidebar width to its minimum when the window narrows", async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    const component = fixture.componentInstance;

    window.innerWidth = 512; // half the default 1024
    component.onWindowResize();

    expect(component.sidebarWidth()).toBe(200);
  });

  it("clamps the sidebar width to its maximum when the window widens a lot", async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    const component = fixture.componentInstance;

    window.innerWidth = 10240; // 10x the default 1024
    component.onWindowResize();

    expect(component.sidebarWidth()).toBe(1200);
  });

  it("scales the publish height proportionally when the window grows taller", async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    const component = fixture.componentInstance;

    const startHeight = component.publishHeight();
    window.innerHeight = 1536; // double the default 768
    component.onWindowResize();

    expect(component.publishHeight()).toBe(startHeight * 2);
  });

  it("clamps the publish height to its minimum when the window gets shorter", async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    const component = fixture.componentInstance;

    window.innerHeight = 384; // half the default 768
    component.onWindowResize();

    expect(component.publishHeight()).toBe(200);
  });

  it("clamps the publish height to its maximum when the window gets much taller", async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    const component = fixture.componentInstance;

    window.innerHeight = 2304; // 3x the default 768
    component.onWindowResize();

    expect(component.publishHeight()).toBe(560);
  });

  it("does not resize the publish panel when only the width changes", async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    const component = fixture.componentInstance;

    const startHeight = component.publishHeight();
    window.innerWidth = 2048;
    component.onWindowResize();

    expect(component.publishHeight()).toBe(startHeight);
  });

  it("does not keep growing across repeated resize events at the same size", async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    const component = fixture.componentInstance;

    const startWidth = component.sidebarWidth();
    const startHeight = component.publishHeight();
    component.onWindowResize();
    component.onWindowResize();
    component.onWindowResize();

    expect(component.sidebarWidth()).toBe(startWidth);
    expect(component.publishHeight()).toBe(startHeight);
  });

  it("returns to the original size after the window grows and then shrinks back", async () => {
    const { fixture } = await setup();
    await fixture.whenStable();
    const component = fixture.componentInstance;

    const startWidth = component.sidebarWidth();
    const startHeight = component.publishHeight();

    window.innerWidth = 2048;
    window.innerHeight = 1536;
    component.onWindowResize();
    window.innerWidth = 1024;
    window.innerHeight = 768;
    component.onWindowResize();

    expect(component.sidebarWidth()).toBe(startWidth);
    expect(component.publishHeight()).toBe(startHeight);
  });

  it("loads a message resent from the stream into the publish panel", async () => {
    const { fixture } = await setup();
    await fixture.whenStable();

    const stream = fixture.debugElement.query(By.directive(MessageStream))
      .componentInstance as MessageStream;
    stream.resendRequested.emit({
      topic: "sensors/zone-b",
      payload: '{"b":2}',
      format: "json",
      qos: "AtLeastOnce",
      retain: true,
    });
    fixture.detectChanges();

    const panel = fixture.debugElement.query(By.directive(PublishPanel))
      .componentInstance as PublishPanel;
    expect(panel.form.controls.topic.value).toBe("sensors/zone-b");
    expect(panel.form.controls.payload.value).toBe('{"b":2}');
    expect(panel.qos()).toBe("AtLeastOnce");
    expect(panel.retain()).toBe(true);
  });

  it("selecting a topic opens its stream without touching the publish topic", async () => {
    const { fixture } = await setup();
    await fixture.whenStable();

    const panel = fixture.debugElement.query(By.directive(PublishPanel))
      .componentInstance as PublishPanel;
    panel.form.controls.topic.setValue("typed/by/hand");

    const tree = fixture.debugElement.query(By.directive(TopicTree))
      .componentInstance as TopicTree;
    tree.topicSelected.emit("sensors/zone-a");
    fixture.detectChanges();

    const stream = fixture.debugElement.query(By.directive(MessageStream))
      .componentInstance as MessageStream;
    expect(stream.topic()).toBe("sensors/zone-a");
    expect(panel.form.controls.topic.value).toBe("typed/by/hand");
  });

  it("double-clicking a topic points the publish panel at it", async () => {
    const { fixture } = await setup();
    await fixture.whenStable();

    const tree = fixture.debugElement.query(By.directive(TopicTree))
      .componentInstance as TopicTree;
    tree.publishTopicRequested.emit("sensors/zone-a");
    fixture.detectChanges();

    const panel = fixture.debugElement.query(By.directive(PublishPanel))
      .componentInstance as PublishPanel;
    expect(panel.form.controls.topic.value).toBe("sensors/zone-a");
  });
});
