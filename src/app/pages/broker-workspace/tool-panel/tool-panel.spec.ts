import { TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { of } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { MessageStoreService } from "../../../core/services/message-store.service";
import { SessionStatsService } from "../../../core/services/session-stats.service";
import { SystemMonitorService } from "../../../core/services/system-monitor.service";
import { ToolPanel } from "./tool-panel";
import { ValueCharts } from "./value-charts/value-charts";

const CONNECTION_ID = "11111111-1111-1111-1111-111111111111";

async function setup() {
  TestBed.configureTestingModule({
    imports: [ToolPanel],
    providers: [
      {
        provide: MessageStoreService,
        useValue: {
          messagesFor: vi.fn().mockReturnValue(of([])),
          // The broker tool reads the whole topic map to pick $SYS out of it.
          topicsFor: vi.fn().mockReturnValue(of(new Map())),
        },
      },
      {
        provide: SessionStatsService,
        useValue: { statsOf: () => null },
      },
      {
        provide: SystemMonitorService,
        useValue: { isMonitoring: () => false },
      },
    ],
  });

  const fixture = TestBed.createComponent(ToolPanel);
  fixture.componentRef.setInput("connectionId", CONNECTION_ID);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture };
}

/** A tab by its visible label - the strip's order is a product decision, not
 * something each test should have to agree with. */
function tabNamed(
  fixture: { nativeElement: HTMLElement },
  label: string,
): HTMLElement {
  const tabs = [
    ...fixture.nativeElement.querySelectorAll<HTMLElement>("[role=tab]"),
  ];
  const tab = tabs.find((candidate) => candidate.textContent?.trim() === label);
  if (tab === undefined) {
    throw new Error(`No tool tab labelled "${label}"`);
  }
  return tab;
}

describe("ToolPanel", () => {
  it("shows the charts tool by default", async () => {
    const { fixture } = await setup();

    expect(fixture.componentInstance.activeTool()).toBe("charts");
    expect(
      fixture.nativeElement.querySelector("app-value-charts"),
    ).toBeTruthy();
  });

  it("shows one tab per tool, with the active one marked", async () => {
    const { fixture } = await setup();

    const tabs = [...fixture.nativeElement.querySelectorAll("[role=tab]")];
    expect(tabs.map((tab: HTMLElement) => tab.textContent?.trim())).toEqual([
      "Charts",
      "Compare",
      "Broker",
    ]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    // Only the selected tab is in the tab order - a roving tabindex, so the
    // strip is one Tab stop rather than one per tool.
    expect(
      tabs.map((tab: HTMLElement) => tab.getAttribute("tabindex")),
    ).toEqual(["0", "-1", "-1"]);
  });

  it("switches tools when a tab is clicked", async () => {
    const { fixture } = await setup();

    // Found by its label rather than its index, so inserting a tool between
    // Charts and Broker stops being a reason for this test to fail.
    const broker = tabNamed(fixture, "Broker");
    broker.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.activeTool()).toBe("broker");
    expect(
      fixture.nativeElement.querySelector("app-broker-stats"),
    ).toBeTruthy();
    expect(fixture.nativeElement.querySelector("app-value-charts")).toBeNull();
  });

  /** Selection follows focus, per the ARIA tabs pattern - so the arrow key
   * has to move the DOM focus too, or the next press comes from an element
   * that is no longer in the tab order. */
  it("moves between tools with the arrow keys, wrapping at the ends", async () => {
    const { fixture } = await setup();
    const tabs = [...fixture.nativeElement.querySelectorAll("[role=tab]")];

    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    fixture.detectChanges();
    expect(fixture.componentInstance.activeTool()).toBe("compare");
    expect(document.activeElement).toBe(tabs[1]);

    tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    fixture.detectChanges();
    expect(fixture.componentInstance.activeTool()).toBe("broker");
    expect(document.activeElement).toBe(tabs[2]);

    tabs[2].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    fixture.detectChanges();
    expect(fixture.componentInstance.activeTool()).toBe("charts");
  });

  it("leaves keys it has no opinion about alone", async () => {
    const { fixture } = await setup();
    const tabs = [...fixture.nativeElement.querySelectorAll("[role=tab]")];

    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    fixture.detectChanges();

    expect(fixture.componentInstance.activeTool()).toBe("charts");
  });

  /** Hiding the dock is the header's job, and having two controls for it
   * meant one of them was always the wrong one to reach for. */
  it("leaves showing and hiding to the header's dock toggle", async () => {
    const { fixture } = await setup();

    expect(fixture.nativeElement.querySelector(".panel-actions")).toBeNull();
  });

  it("hands the workspace's width verdict down so the cards can go two-up", async () => {
    const { fixture } = await setup();

    fixture.componentRef.setInput("wide", true);
    fixture.detectChanges();

    const charts = fixture.debugElement.query(By.directive(ValueCharts))
      .componentInstance as ValueCharts;
    expect(charts.wide()).toBe(true);
  });
});
