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

const C = "cccccccc-3333-3333-3333-333333333333";

const NAMES: Record<string, string> = {
  [A]: "Home Assistant",
  [B]: "Staging",
  [C]: "Production",
};

// A pretend strip: the home button, then equal-width tabs after it. Only the
// centres matter, so the numbers just have to be tellable apart.
const STRIP_LEFT = 40;
const TAB_WIDTH = 100;
const centerX = (index: number) =>
  STRIP_LEFT + index * TAB_WIDTH + TAB_WIDTH / 2;

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
    protocol_version: "v311",
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

async function setup(openIds: string[] = [A, B], widths: number[] = []) {
  const events$ = new Subject<MqttEvent>();

  TestBed.configureTestingModule({
    imports: [WorkspaceTabs],
    providers: [
      // Empty child-less routes so the real router can land on them: the
      // settings tests navigate for real to see the active state follow.
      provideRouter([
        { path: "connections", children: [] },
        { path: "settings", children: [] },
      ]),
      {
        provide: ConnectionsService,
        useValue: {
          get: vi.fn((id: string) => Promise.resolve(connection(id))),
        },
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
  // jsdom lays nothing out and has no pointer capture; the drag needs both.
  element.setPointerCapture = () => undefined;
  element.releasePointerCapture = () => undefined;
  const tabs = () => [...element.querySelectorAll<HTMLElement>(".tab")];
  // Each tab keeps the width it was given however far along the strip it ends
  // up, so its slot is wherever the tabs now in front of it leave off.
  const widthOf = new Map<HTMLElement, number>(
    tabs().map((tab, index) => [tab, widths[index] ?? TAB_WIDTH]),
  );
  const slotLeft = (tab: HTMLElement) =>
    tabs()
      .slice(0, tabs().indexOf(tab))
      .reduce((left, before) => left + (widthOf.get(before) ?? 0), STRIP_LEFT);
  tabs().forEach((tab) => {
    const width = widthOf.get(tab) ?? TAB_WIDTH;
    tab.getBoundingClientRect = () => {
      // Whatever the DOM says right now, shift included - which is what a
      // browser would report mid-drag, before Angular has rendered the move.
      const carried = tab.classList.contains("dragging")
        ? fixture.componentInstance.dragOffset()
        : 0;
      const left = slotLeft(tab) + carried;
      return { left, right: left + width, width } as DOMRect;
    };
  });

  const pointer = (
    target: HTMLElement,
    type: string,
    clientX: number,
    buttons = 1,
  ) => {
    target.dispatchEvent(
      new PointerEvent(type, {
        clientX,
        buttons,
        bubbles: true,
        cancelable: true,
      }),
    );
    fixture.detectChanges();
  };

  /** Grabs the tab now at `index` by its middle and lets go at `toX`. */
  const drag = (index: number, toX: number) => {
    pointer(tabs()[index], "pointerdown", centerX(index));
    pointer(element, "pointermove", toX);
    pointer(element, "pointerup", toX);
  };

  return {
    fixture,
    workspaces,
    navigate,
    router,
    events$,
    element,
    tabs,
    pointer,
    drag,
    names: () => tabs().map((tab) => tab.textContent?.trim()),
    carriedTab: () => element.querySelector<HTMLElement>(".tab.dragging"),
    /** The middle of the slot the tab at `index` currently occupies. */
    slotCenter: (index: number) => {
      const tab = tabs()[index];
      return slotLeft(tab) + (widthOf.get(tab) ?? TAB_WIDTH) / 2;
    },
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

  it("goes to settings from the gear", async () => {
    const { element, navigate } = await setup();

    element.querySelector<HTMLElement>(".settings")?.click();

    expect(navigate).toHaveBeenCalledWith(["/settings"]);
  });

  it("marks the gear, not home, as active on the settings page", async () => {
    const { element, workspaces, fixture, router } = await setup();

    workspaces.deactivate();
    await router.navigateByUrl("/settings");
    fixture.detectChanges();

    expect(element.querySelector(".settings")?.classList).toContain("active");
    expect(element.querySelector(".home")?.classList).not.toContain("active");

    await router.navigateByUrl("/connections");
    fixture.detectChanges();

    expect(element.querySelector(".settings")?.classList).not.toContain(
      "active",
    );
    expect(element.querySelector(".home")?.classList).toContain("active");
  });

  it("reorders tabs by dragging one past its neighbour", async () => {
    const { drag, names } = await setup([A, B, C]);

    drag(0, centerX(1) + 1);

    expect(names()).toEqual(["Staging", "Home Assistant", "Production"]);
  });

  it("lands in the right slot when a drag crosses several tabs", async () => {
    const { drag, names } = await setup([A, B, C]);

    drag(2, centerX(0) - 1);

    expect(names()).toEqual(["Production", "Home Assistant", "Staging"]);
  });

  it("keeps home and the gear at the ends of a dragged-out strip", async () => {
    const { element, drag } = await setup([A, B]);

    drag(0, 99999);
    drag(1, -99999);

    expect(element.firstElementChild?.classList).toContain("home");
    expect(element.lastElementChild?.classList).toContain("settings");
  });

  it("leaves the showing workspace alone when its neighbour moves", async () => {
    const { drag, workspaces } = await setup([A, B]);
    expect(workspaces.activeId()).toBe(B);

    drag(0, centerX(1) + 1);

    expect(workspaces.activeId()).toBe(B);
  });

  it("marks the tab being dragged, and unmarks it on drop", async () => {
    const { tabs, pointer, element } = await setup([A, B]);

    pointer(tabs()[0], "pointerdown", centerX(0));
    pointer(element, "pointermove", centerX(0) + 20);
    expect(tabs()[0].classList).toContain("dragging");

    pointer(element, "pointerup", centerX(0) + 20);
    expect(element.querySelector(".dragging")).toBeNull();
  });

  /** Releasing outside the window leaves no pointerup behind, so the next
   * move over the bar must not be mistaken for the drag carrying on. */
  it("abandons a press whose button came up out of sight", async () => {
    const { tabs, pointer, element, names } = await setup([A, B]);

    pointer(tabs()[0], "pointerdown", centerX(0));
    pointer(element, "pointermove", centerX(1) + 1, 0);

    expect(names()).toEqual(["Home Assistant", "Staging"]);
    expect(element.querySelector(".dragging")).toBeNull();
  });

  it("carries the dragged tab along under the pointer", async () => {
    const { tabs, pointer, element, carriedTab } = await setup([A, B, C]);

    pointer(tabs()[0], "pointerdown", centerX(0));
    pointer(element, "pointermove", centerX(0) + 30);

    // Still in its own slot, but 30px along it.
    expect(carriedTab()?.style.transform).toBe("translateX(30px)");
    expect(carriedTab()?.textContent?.trim()).toBe("Home Assistant");
  });

  it("keeps carrying it once the tabs beneath have swapped", async () => {
    const { tabs, pointer, element, names, carriedTab } = await setup([A, B, C]);

    pointer(tabs()[0], "pointerdown", centerX(0));
    pointer(element, "pointermove", centerX(1) + 10);

    expect(names()).toEqual(["Staging", "Home Assistant", "Production"]);
    expect(carriedTab()?.style.transform).toBe("translateX(10px)");
  });

  it("holds the tab inside the strip however far the pointer goes", async () => {
    const { tabs, pointer, element, names, carriedTab } = await setup([A, B, C]);

    pointer(tabs()[0], "pointerdown", centerX(0));
    pointer(element, "pointermove", 99999);

    // Hard against the end of the run, with nothing hanging over the gear.
    expect(names()).toEqual(["Staging", "Production", "Home Assistant"]);
    expect(carriedTab()?.style.transform).toBe("translateX(0px)");
  });

  it("lets a dropped tab settle back into its slot", async () => {
    const { tabs, pointer, element } = await setup([A, B]);

    pointer(tabs()[0], "pointerdown", centerX(0));
    pointer(element, "pointermove", centerX(0) + 30);
    pointer(element, "pointerup", centerX(0) + 30);

    expect(tabs()[0].style.transform).toBe("");
  });

  /** Broker names make tabs of different widths, and the wider of a pair used
   * to be unable to swap: carried hard against the end of the strip, its
   * centre still had not reached the narrow tab's. */
  it("swaps a wide tab past a narrow one", async () => {
    const { tabs, pointer, element, names, slotCenter } = await setup(
      [A, B],
      [80, 160],
    );

    const grab = slotCenter(1);
    pointer(tabs()[1], "pointerdown", grab);
    pointer(element, "pointermove", grab - 45);

    expect(names()).toEqual(["Staging", "Home Assistant"]);
  });

  it("swaps a narrow tab past a wide one just the same", async () => {
    const { tabs, pointer, element, names, slotCenter } = await setup(
      [A, B],
      [80, 160],
    );

    const grab = slotCenter(0);
    pointer(tabs()[0], "pointerdown", grab);
    pointer(element, "pointermove", grab + 85);

    expect(names()).toEqual(["Staging", "Home Assistant"]);
  });

  it("does not switch workspace when a drag ends on a tab", async () => {
    const { tabs, drag, navigate } = await setup([A, B]);

    drag(0, centerX(1) + 1);
    tabs()[1].click();

    expect(navigate).not.toHaveBeenCalled();
  });

  /** A press that wobbles a pixel or two is still a click, not a drag. */
  it("still switches workspace when the press barely moves", async () => {
    const { tabs, pointer, element, navigate, names } = await setup([A, B]);

    pointer(tabs()[0], "pointerdown", centerX(0));
    pointer(element, "pointermove", centerX(0) + 2);
    pointer(element, "pointerup", centerX(0) + 2);
    tabs()[0].click();

    expect(navigate).toHaveBeenCalledWith(["/broker", A]);
    expect(names()).toEqual(["Home Assistant", "Staging"]);
  });

  it("drops a tab once its workspace closes", async () => {
    const { tabs, workspaces, fixture } = await setup();

    workspaces.close(A);
    fixture.detectChanges();

    expect(tabs().map((tab) => tab.textContent?.trim())).toEqual(["Staging"]);
  });
});
