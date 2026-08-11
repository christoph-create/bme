import { ComponentFixture, TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { Router, provideRouter } from "@angular/router";
import { Subject, of } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrokerConnection } from "../../core/models/broker-connection.model";
import { MqttEvent } from "../../core/models/mqtt-event.model";
import { ConnectionsService } from "../../core/services/connections.service";
import { MessageStoreService } from "../../core/services/message-store.service";
import { MqttEventsService } from "../../core/services/mqtt-events.service";
import { WorkspacesService } from "../../core/services/workspaces.service";
import { Splitter } from "../../shared/splitter/splitter";
import { BrokerWorkspace } from "./broker-workspace";
import { MessageStream } from "./message-stream/message-stream";
import { PublishPanel } from "./publish-panel/publish-panel";
import { ToolPanel } from "./tool-panel/tool-panel";
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
          clear: vi.fn(),
        },
      },
      { provide: MqttEventsService, useValue: { events$ } },
    ],
  });

  const fixture = TestBed.createComponent(BrokerWorkspace);
  fixture.componentRef.setInput("connectionId", CONNECTION_ID);
  const workspaces = TestBed.inject(WorkspacesService);
  workspaces.open(CONNECTION_ID);
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, "navigate").mockResolvedValue(true);
  fixture.detectChanges();

  return { fixture, connect, disconnect, navigate, events$, workspaces };
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

  it("connects to the broker it was given on init", async () => {
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

  // The status rules themselves live in `core/status/connection-status.spec.ts`
  // and the service's own spec; these run the real service end to end, to prove
  // the header and the banners are reading it.
  describe("connection status", () => {
    const text = (fixture: ComponentFixture<BrokerWorkspace>) =>
      (fixture.nativeElement as HTMLElement).textContent ?? "";

    it("stays on Connecting until the broker confirms the session", async () => {
      const { fixture, events$ } = await setup();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(text(fixture)).toContain("Connecting…");

      events$.next({ Connected: { connection_id: CONNECTION_ID } });
      fixture.detectChanges();

      expect(text(fixture)).toContain("Connected");
      expect(fixture.componentInstance.connected()).toBe(true);
    });

    it("ignores events for other connections", async () => {
      const { fixture, events$ } = await setup();
      await fixture.whenStable();

      events$.next({ Connected: { connection_id: OTHER_CONNECTION_ID } });
      fixture.detectChanges();

      expect(fixture.componentInstance.connected()).toBe(false);
      expect(text(fixture)).toContain("Connecting…");
    });

    it("shows the retry count and a Stop button while the backend retries", async () => {
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

      const banner = (fixture.nativeElement as HTMLElement).querySelector(
        ".reconnect-banner",
      );
      expect(banner?.textContent).toContain("Reconnecting… (attempt 3 of 10)");
      expect(banner?.querySelector("button")?.textContent?.trim()).toBe("Stop");
      // Retrying is not connected: there is no session to publish over.
      expect(fixture.componentInstance.connected()).toBe(false);
    });

    it("falls back to the error banner when the broker drops the session", async () => {
      const { fixture, events$ } = await setup();
      await fixture.whenStable();

      events$.next({ Disconnected: { connection_id: CONNECTION_ID } });
      fixture.detectChanges();

      const element = fixture.nativeElement as HTMLElement;
      expect(element.querySelector(".reconnect-banner")).toBeNull();
      expect(element.querySelector(".connect-error-banner")?.textContent).toContain(
        "Disconnected from broker",
      );
    });

    it("disconnects, closes its tab and goes back to Connections", async () => {
      const { fixture, disconnect, navigate, workspaces } = await setup();
      await fixture.whenStable();

      await fixture.componentInstance.disconnect();

      expect(disconnect).toHaveBeenCalledWith(CONNECTION_ID);
      expect(workspaces.openIds()).toEqual([]);
      expect(navigate).toHaveBeenCalledWith(["/connections"]);
    });

    it("activates the neighbouring tab when one is left", async () => {
      const { fixture, navigate, workspaces } = await setup();
      await fixture.whenStable();
      workspaces.open(OTHER_CONNECTION_ID);

      await fixture.componentInstance.disconnect();

      expect(workspaces.openIds()).toEqual([OTHER_CONNECTION_ID]);
      expect(navigate).toHaveBeenCalledWith(["/broker", OTHER_CONNECTION_ID]);
    });

    it("stays put and surfaces the reason if disconnecting fails", async () => {
      const disconnect = vi.fn().mockRejectedValue(new Error("still busy"));
      const { fixture, navigate } = await setup({ disconnect });
      await fixture.whenStable();

      await fixture.componentInstance.disconnect();
      fixture.detectChanges();

      expect(navigate).not.toHaveBeenCalled();
      expect(text(fixture)).toContain("still busy");
      expect(fixture.componentInstance.connectionId()).toBe(CONNECTION_ID);
    });
  });

  // The sizing rules themselves live in `layout/dock-layout.spec.ts`; these
  // only prove each handle is wired to the dock it sits next to.
  describe("the splitters", () => {
    function splitter(
      fixture: ComponentFixture<BrokerWorkspace>,
      className: string,
    ): Splitter {
      const handle = fixture.debugElement
        .queryAll(By.directive(Splitter))
        .find((candidate) =>
          (candidate.nativeElement as HTMLElement).classList.contains(
            className,
          ),
        );
      expect(handle).toBeDefined();
      return handle?.componentInstance as Splitter;
    }

    it("widens the sidebar as its handle is dragged right", async () => {
      const { fixture } = await setup();
      await fixture.whenStable();
      const handle = splitter(fixture, "resizer-col");

      handle.dragStarted.emit();
      handle.dragged.emit(40);
      fixture.detectChanges();

      expect(fixture.componentInstance.gridTemplateColumns()).toBe(
        "300px 6px 1fr 0 0",
      );
    });

    it("grows the publish dock as its handle is dragged up", async () => {
      const { fixture } = await setup();
      await fixture.whenStable();
      const handle = splitter(fixture, "resizer-row");

      handle.dragStarted.emit();
      handle.dragged.emit(-40);
      fixture.detectChanges();

      expect(fixture.componentInstance.gridTemplateRows()).toBe(
        "1fr 6px 300px",
      );
    });

    it("shrinks the tools dock as its handle is dragged right", async () => {
      const { fixture } = await setup();
      await fixture.whenStable();
      fixture.componentInstance.toggleDock("tools");
      fixture.detectChanges();
      const handle = splitter(fixture, "resizer-tool");

      handle.dragStarted.emit();
      handle.dragged.emit(40);
      fixture.detectChanges();

      expect(fixture.componentInstance.gridTemplateColumns()).toBe(
        "260px 6px 1fr 6px 320px",
      );
    });

    it("resolves each drag against the size that drag started from", async () => {
      const { fixture } = await setup();
      await fixture.whenStable();
      const handle = splitter(fixture, "resizer-col");

      handle.dragStarted.emit();
      handle.dragged.emit(40);
      handle.dragEnded.emit();
      handle.dragStarted.emit();
      handle.dragged.emit(40);
      fixture.detectChanges();

      expect(fixture.componentInstance.gridTemplateColumns()).toBe(
        "340px 6px 1fr 0 0",
      );
    });

    it("suppresses text selection only while a drag is in flight", async () => {
      const { fixture } = await setup();
      await fixture.whenStable();
      const handle = splitter(fixture, "resizer-col");
      const layout = () =>
        (fixture.nativeElement as HTMLElement).querySelector(".layout");

      handle.dragStarted.emit();
      fixture.detectChanges();
      expect(layout()?.classList.contains("resizing")).toBe(true);

      handle.dragEnded.emit();
      fixture.detectChanges();
      expect(layout()?.classList.contains("resizing")).toBe(false);
    });
  });

  describe("the dock toggles", () => {
    function toggleButton(
      fixture: ComponentFixture<BrokerWorkspace>,
      label: string,
    ): HTMLButtonElement {
      return (fixture.nativeElement as HTMLElement).querySelector(
        `.header-actions button[aria-label="${label}"]`,
      ) as HTMLButtonElement;
    }

    it("opens with the side docks showing and the tools dock put away", async () => {
      const { fixture } = await setup();
      await fixture.whenStable();

      expect(fixture.componentInstance.docksOpen()).toEqual({
        subscriptions: true,
        publish: true,
        tools: false,
      });
      expect(toggleButton(fixture, "Subscriptions panel").getAttribute("aria-pressed")).toBe(
        "true",
      );
      expect(toggleButton(fixture, "Tools panel").getAttribute("aria-pressed")).toBe(
        "false",
      );
    });

    it("collapses the subscriptions dock's tracks when its button is pressed", async () => {
      const { fixture } = await setup();
      await fixture.whenStable();

      toggleButton(fixture, "Subscriptions panel").click();
      fixture.detectChanges();

      expect(fixture.componentInstance.gridTemplateColumns()).toBe(
        "0 0 1fr 0 0",
      );
      expect(fixture.nativeElement.querySelector(".resizer-col")).toBeNull();
    });

    it("collapses the publish dock's rows when its button is pressed", async () => {
      const { fixture } = await setup();
      await fixture.whenStable();

      toggleButton(fixture, "Publish panel").click();
      fixture.detectChanges();

      expect(fixture.componentInstance.gridTemplateRows()).toBe("1fr 0 0");
      expect(fixture.nativeElement.querySelector(".resizer-row")).toBeNull();
    });

    it("gives the tools dock a column of its own when its button is pressed", async () => {
      const { fixture } = await setup();
      await fixture.whenStable();

      toggleButton(fixture, "Tools panel").click();
      fixture.detectChanges();

      expect(fixture.componentInstance.gridTemplateColumns()).toBe(
        "260px 6px 1fr 6px 360px",
      );
      expect(fixture.nativeElement.querySelector(".resizer-tool")).toBeTruthy();
    });

    it("toggles each dock independently of the others", async () => {
      const { fixture } = await setup();
      await fixture.whenStable();

      toggleButton(fixture, "Subscriptions panel").click();
      fixture.detectChanges();

      expect(fixture.componentInstance.docksOpen()).toEqual({
        subscriptions: false,
        publish: true,
        tools: false,
      });
    });

    it("restores the size a dock was dragged to when it is reopened", async () => {
      const { fixture } = await setup();
      await fixture.whenStable();
      const handle = fixture.debugElement
        .queryAll(By.directive(Splitter))
        .find((candidate) =>
          (candidate.nativeElement as HTMLElement).classList.contains(
            "resizer-col",
          ),
        )?.componentInstance as Splitter;
      handle.dragStarted.emit();
      handle.dragged.emit(40);
      fixture.detectChanges();

      toggleButton(fixture, "Subscriptions panel").click();
      fixture.detectChanges();
      toggleButton(fixture, "Subscriptions panel").click();
      fixture.detectChanges();

      expect(fixture.componentInstance.gridTemplateColumns()).toBe(
        "300px 6px 1fr 0 0",
      );
    });
  });

  describe("the tool panel", () => {
    it("stays mounted while its dock is hidden, so the charts keep filling", async () => {
      const { fixture } = await setup();
      await fixture.whenStable();

      expect(fixture.componentInstance.docksOpen().tools).toBe(false);
      expect(
        fixture.debugElement.query(By.directive(ToolPanel)),
      ).not.toBeNull();
    });

    it("closes its dock from its own close button", async () => {
      const { fixture } = await setup();
      await fixture.whenStable();
      const component = fixture.componentInstance;
      component.toggleDock("tools");
      fixture.detectChanges();

      const panel = fixture.debugElement.query(By.directive(ToolPanel))
        .componentInstance as ToolPanel;
      panel.closeRequested.emit();
      fixture.detectChanges();

      expect(component.docksOpen().tools).toBe(false);
    });

    it("freezes the charts with the message stream's pause", async () => {
      const { fixture } = await setup();
      await fixture.whenStable();
      const component = fixture.componentInstance;
      component.toggleDock("tools");
      fixture.detectChanges();

      const stream = fixture.debugElement.query(By.directive(MessageStream))
        .componentInstance as MessageStream;
      stream.togglePause();
      fixture.detectChanges();

      expect(component.paused()).toBe(true);
      const panel = fixture.debugElement.query(By.directive(ToolPanel))
        .componentInstance as ToolPanel;
      expect(panel.paused()).toBe(true);

      stream.togglePause();
      fixture.detectChanges();
      expect(panel.paused()).toBe(false);
    });

    it("goes to two columns of charts once dragged wide enough", async () => {
      const { fixture } = await setup();
      await fixture.whenStable();
      const component = fixture.componentInstance;
      component.toggleDock("tools");
      fixture.detectChanges();
      expect(component.toolsWide()).toBe(false);

      // 1024 wide leaves the dock 444 at most, so the window has to grow too.
      window.innerWidth = 2048;
      component.onWindowResize();

      expect(component.toolsWide()).toBe(true);
    });
  });
});
