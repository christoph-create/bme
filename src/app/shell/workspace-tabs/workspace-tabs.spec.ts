import { TestBed } from "@angular/core/testing";
import { Router, provideRouter } from "@angular/router";
import { Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { BrokerConnection } from "../../core/models/broker-connection.model";
import { MqttEvent } from "../../core/models/mqtt-event.model";
import { ConnectionsService } from "../../core/services/connections.service";
import { MessageStoreService } from "../../core/services/message-store.service";
import { MqttEventsService } from "../../core/services/mqtt-events.service";
import { ValueChartsService } from "../../core/services/value-charts.service";
import { WorkspacesService } from "../../core/services/workspaces.service";
import { WorkspaceTabs } from "./workspace-tabs";

const A = "aaaaaaaa-1111-1111-1111-111111111111";
const B = "bbbbbbbb-2222-2222-2222-222222222222";

const NAMES: Record<string, string> = { [A]: "Home Assistant", [B]: "Staging" };

function connection(id: string): BrokerConnection {
  return {
    id,
    name: NAMES[id],
    host: "localhost",
    port: 1883,
    client_id: "bme",
    username: null,
    password: null,
    scheme: "mqtt",
    ws_path: null,
    ca_cert_path: null,
    client_cert_path: null,
    client_key_path: null,
    alpn: null,
    skip_cert_verification: false,
    keep_alive_secs: 30,
    auto_reconnect: true,
    max_reconnect_attempts: 10,
    subscriptions: [],
  };
}

async function setup(openIds: string[] = [A, B]) {
  const events$ = new Subject<MqttEvent>();

  TestBed.configureTestingModule({
    imports: [WorkspaceTabs],
    providers: [
      provideRouter([]),
      {
        provide: ConnectionsService,
        useValue: { get: vi.fn((id: string) => Promise.resolve(connection(id))) },
      },
      { provide: MessageStoreService, useValue: { clear: vi.fn() } },
      { provide: ValueChartsService, useValue: { removeAllFor: vi.fn() } },
      { provide: MqttEventsService, useValue: { events$ } },
    ],
  });

  const workspaces = TestBed.inject(WorkspacesService);
  openIds.forEach((id) => workspaces.open(id));

  const fixture = TestBed.createComponent(WorkspaceTabs);
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, "navigate").mockResolvedValue(true);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  const element = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    workspaces,
    navigate,
    events$,
    element,
    tabs: () => [...element.querySelectorAll<HTMLElement>(".tab")],
  };
}

describe("WorkspaceTabs", () => {
  it("shows one tab per open workspace, named after its broker", async () => {
    const { tabs } = await setup();

    expect(tabs().map((tab) => tab.textContent?.trim())).toEqual([
      "Home Assistant",
      "Staging",
    ]);
  });

  it("marks the active workspace's tab", async () => {
    const { tabs, workspaces, fixture } = await setup();
    expect(tabs()[1].classList).toContain("active");
    expect(tabs()[1].getAttribute("aria-current")).toBe("page");

    workspaces.open(A);
    fixture.detectChanges();

    expect(tabs()[0].classList).toContain("active");
    expect(tabs()[1].classList).not.toContain("active");
  });

  it("switches workspace by navigating to that broker's route", async () => {
    const { tabs, navigate } = await setup();

    tabs()[0].click();

    expect(navigate).toHaveBeenCalledWith(["/broker", A]);
  });

  it("carries each broker's live status as a dot", async () => {
    const { tabs, events$, fixture } = await setup();

    events$.next({ Connected: { connection_id: A } });
    fixture.detectChanges();

    expect(tabs()[0].querySelector("app-status-dot")?.className).toBe(
      "connected",
    );
    expect(tabs()[1].querySelector("app-status-dot")?.className).toBe("idle");
  });

  /** Disconnect is the only way to end a session, so there is deliberately no
   * × to hit by accident. */
  it("gives tabs no close button", async () => {
    const { element } = await setup();

    expect(element.querySelector(".tab button")).toBeNull();
    expect(element.textContent).not.toContain("×");
  });

  it("goes to the broker list from the home button", async () => {
    const { element, navigate } = await setup();

    element.querySelector<HTMLElement>(".home")?.click();

    expect(navigate).toHaveBeenCalledWith(["/connections"]);
  });

  it("marks home as active when no workspace is showing", async () => {
    const { element, workspaces, fixture } = await setup();

    workspaces.deactivate();
    fixture.detectChanges();

    expect(element.querySelector(".home")?.classList).toContain("active");
  });

  it("drops a tab once its workspace closes", async () => {
    const { tabs, workspaces, fixture } = await setup();

    workspaces.close(A);
    fixture.detectChanges();

    expect(tabs().map((tab) => tab.textContent?.trim())).toEqual(["Staging"]);
  });
});
