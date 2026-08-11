import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import { Splitter } from "./splitter";

@Component({
  imports: [Splitter],
  template: `
    <app-splitter
      [orientation]="orientation()"
      (dragStarted)="events.push('start')"
      (dragged)="deltas.push($event)"
      (dragEnded)="events.push('end')"
    />
  `,
})
class Host {
  readonly orientation = signal<"vertical" | "horizontal">("vertical");
  readonly deltas: number[] = [];
  readonly events: string[] = [];
}

function setup(orientation: "vertical" | "horizontal" = "vertical") {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.orientation.set(orientation);
  fixture.detectChanges();

  const handle = (fixture.nativeElement as HTMLElement).querySelector(
    "app-splitter",
  ) as HTMLElement;
  // jsdom has no pointer capture; the handle calls it on every drag.
  handle.setPointerCapture = () => undefined;
  handle.releasePointerCapture = () => undefined;

  const dispatch = (type: string, x: number, y: number) => {
    handle.dispatchEvent(
      new PointerEvent(type, {
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
      }),
    );
    fixture.detectChanges();
  };

  return { fixture, handle, dispatch, host: fixture.componentInstance };
}

describe("Splitter", () => {
  it("reports the pointer's movement along its own axis", () => {
    const { dispatch, host } = setup("vertical");

    dispatch("pointerdown", 200, 400);
    dispatch("pointermove", 240, 999);

    expect(host.deltas).toEqual([40]);
  });

  it("reports vertical movement when it is a horizontal handle", () => {
    const { dispatch, host } = setup("horizontal");

    dispatch("pointerdown", 200, 400);
    dispatch("pointermove", 999, 360);

    expect(host.deltas).toEqual([-40]);
  });

  it("reports the delta cumulatively from where the drag started", () => {
    const { dispatch, host } = setup();

    dispatch("pointerdown", 200, 0);
    dispatch("pointermove", 220, 0);
    dispatch("pointermove", 260, 0);

    expect(host.deltas).toEqual([20, 60]);
  });

  it("ignores pointer movement before a drag has started", () => {
    const { dispatch, host } = setup();

    dispatch("pointermove", 240, 0);

    expect(host.deltas).toEqual([]);
    expect(host.events).toEqual([]);
  });

  it("stops reporting after the pointer is released", () => {
    const { dispatch, host } = setup();

    dispatch("pointerdown", 200, 0);
    dispatch("pointerup", 200, 0);
    dispatch("pointermove", 240, 0);

    expect(host.deltas).toEqual([]);
    expect(host.events).toEqual(["start", "end"]);
  });

  it("ends the drag when the pointer is cancelled", () => {
    const { dispatch, host } = setup();

    dispatch("pointerdown", 200, 0);
    dispatch("pointercancel", 200, 0);

    expect(host.events).toEqual(["start", "end"]);
  });

  it("marks itself as dragging only while the pointer is down", () => {
    const { dispatch, handle } = setup();

    dispatch("pointerdown", 200, 0);
    expect(handle.classList.contains("dragging")).toBe(true);

    dispatch("pointerup", 200, 0);
    expect(handle.classList.contains("dragging")).toBe(false);
  });

  it("carries its orientation as a class, for the cursor and the grip", () => {
    const { fixture, handle } = setup("vertical");
    expect(handle.classList.contains("vertical")).toBe(true);

    fixture.componentInstance.orientation.set("horizontal");
    fixture.detectChanges();

    expect(handle.classList.contains("horizontal")).toBe(true);
    expect(handle.classList.contains("vertical")).toBe(false);
  });
});
