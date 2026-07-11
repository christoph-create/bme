import { ComponentFixture, TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BrokerWorkspace } from "./broker-workspace";

function pointerEvent(x: number, y: number): PointerEvent {
  return { clientX: x, clientY: y, preventDefault: vi.fn() } as unknown as PointerEvent;
}

describe("BrokerWorkspace", () => {
  let component: BrokerWorkspace;
  let fixture: ComponentFixture<BrokerWorkspace>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BrokerWorkspace],
    }).compileComponents();

    fixture = TestBed.createComponent(BrokerWorkspace);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it("should create", () => {
    expect(component).toBeTruthy();
  });

  it("widens the sidebar as the column resizer is dragged right", () => {
    const startWidth = component.sidebarWidth();
    component.startColumnResize(pointerEvent(200, 0));
    component.onPointerMove(pointerEvent(240, 0));

    expect(component.sidebarWidth()).toBe(startWidth + 40);
  });

  it("clamps the sidebar width to its minimum", () => {
    component.startColumnResize(pointerEvent(200, 0));
    component.onPointerMove(pointerEvent(-5000, 0));

    expect(component.sidebarWidth()).toBe(200);
  });

  it("clamps the sidebar width to its maximum", () => {
    component.startColumnResize(pointerEvent(200, 0));
    component.onPointerMove(pointerEvent(5000, 0));

    expect(component.sidebarWidth()).toBe(420);
  });

  it("grows the publish panel when the row resizer is dragged up", () => {
    const startHeight = component.publishHeight();
    component.startRowResize(pointerEvent(0, 300));
    component.onPointerMove(pointerEvent(0, 260));

    expect(component.publishHeight()).toBe(startHeight + 40);
  });

  it("clamps the publish height to its minimum", () => {
    component.startRowResize(pointerEvent(0, 300));
    component.onPointerMove(pointerEvent(0, 5000));

    expect(component.publishHeight()).toBe(160);
  });

  it("clamps the publish height to its maximum", () => {
    component.startRowResize(pointerEvent(0, 300));
    component.onPointerMove(pointerEvent(0, -5000));

    expect(component.publishHeight()).toBe(560);
  });

  it("stops resizing after pointerup", () => {
    const startWidth = component.sidebarWidth();
    component.startColumnResize(pointerEvent(200, 0));
    component.onPointerUp();
    component.onPointerMove(pointerEvent(240, 0));

    expect(component.sidebarWidth()).toBe(startWidth);
  });
});
