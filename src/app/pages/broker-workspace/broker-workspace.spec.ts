import { TestBed } from "@angular/core/testing";
import {
  ActivatedRoute,
  Router,
  convertToParamMap,
  provideRouter,
} from "@angular/router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectionsService } from "../../core/services/connections.service";
import { BrokerWorkspace } from "./broker-workspace";

const CONNECTION_ID = "11111111-1111-1111-1111-111111111111";

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
  } = {},
) {
  const connect = options.connect ?? vi.fn().mockResolvedValue(undefined);
  const disconnect =
    options.disconnect ?? vi.fn().mockResolvedValue(undefined);

  TestBed.configureTestingModule({
    imports: [BrokerWorkspace],
    providers: [
      provideRouter([]),
      { provide: ConnectionsService, useValue: { connect, disconnect } },
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

  return { fixture, connect, disconnect, navigate };
}

describe("BrokerWorkspace", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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

  it("shows a connecting indicator while the initial connect is in flight", async () => {
    let resolveConnect: () => void = vi.fn();
    const connect = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        resolveConnect = resolve;
      }),
    );

    const { fixture } = await setup({ connect });

    expect(fixture.componentInstance.connecting()).toBe(true);

    resolveConnect();
    await fixture.whenStable();

    expect(fixture.componentInstance.connecting()).toBe(false);
  });

  it("shows an error when the initial connect fails", async () => {
    const connect = vi.fn().mockRejectedValue(new Error("broker unreachable"));

    const { fixture } = await setup({ connect });
    await fixture.whenStable();

    expect(fixture.componentInstance.connecting()).toBe(false);
    expect(fixture.componentInstance.connectError()).toBe(
      "broker unreachable",
    );
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

    expect(component.sidebarWidth()).toBe(420);
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

    expect(component.publishHeight()).toBe(160);
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
});
