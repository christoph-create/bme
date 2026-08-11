import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MeasureHeight } from "./measure-height.directive";

/** jsdom has no ResizeObserver, so the directive's whole contract - what it
 * does with the sizes it is handed - is unobservable without one. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];

  constructor(private readonly callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }

  observed = 0;

  observe(): void {
    this.observed += 1;
  }

  disconnect(): void {
    this.observed -= 1;
  }

  trigger(): void {
    this.callback();
  }
}

@Component({
  imports: [MeasureHeight],
  template: `<div appMeasureHeight (heightChange)="heights.push($event)"></div>`,
})
class Host {
  readonly heights: number[] = [];
  readonly offsetHeight = signal(0);
}

describe("MeasureHeight", () => {
  let original: typeof ResizeObserver | undefined;

  beforeEach(() => {
    original = globalThis.ResizeObserver;
    FakeResizeObserver.instances = [];
    globalThis.ResizeObserver =
      FakeResizeObserver as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    globalThis.ResizeObserver = original as typeof ResizeObserver;
  });

  function setup(offsetHeight: number) {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    const element = (fixture.nativeElement as HTMLElement).querySelector(
      "div",
    ) as HTMLElement;
    Object.defineProperty(element, "offsetHeight", {
      configurable: true,
      get: () => offsetHeight,
    });

    return { fixture, observer: FakeResizeObserver.instances[0] };
  }

  it("reports the height it measures", () => {
    const { fixture, observer } = setup(42);

    expect(observer.observed).toBe(1);
    observer.trigger();

    expect(fixture.componentInstance.heights).toEqual([42]);
  });

  it("stops observing when the row goes away", () => {
    const { fixture, observer } = setup(42);

    fixture.destroy();

    expect(observer.observed).toBe(0);
  });

  /** A hidden tab measures zero. Reporting it would collapse the virtualized
   * list's total height and take its scroll position with it. */
  it("says nothing when the element is hidden", () => {
    const { fixture, observer } = setup(0);

    observer.trigger();

    expect(fixture.componentInstance.heights).toEqual([]);
  });

  it("does nothing at all without a ResizeObserver", () => {
    globalThis.ResizeObserver = undefined as unknown as typeof ResizeObserver;

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    expect(FakeResizeObserver.instances).toHaveLength(0);
    expect(fixture.componentInstance.heights).toEqual([]);
  });
});
