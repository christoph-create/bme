import { TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { of } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { MessageStoreService } from "../../../core/services/message-store.service";
import { ToolPanel } from "./tool-panel";
import { ValueCharts } from "./value-charts/value-charts";

const CONNECTION_ID = "11111111-1111-1111-1111-111111111111";

async function setup() {
  TestBed.configureTestingModule({
    imports: [ToolPanel],
    providers: [
      {
        provide: MessageStoreService,
        useValue: { messagesFor: vi.fn().mockReturnValue(of([])) },
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

describe("ToolPanel", () => {
  it("shows the charts tool by default", async () => {
    const { fixture } = await setup();

    expect(fixture.componentInstance.activeTool()).toBe("charts");
    expect(fixture.nativeElement.querySelector("app-value-charts")).toBeTruthy();
  });

  it("titles the panel rather than showing a one-option switcher", async () => {
    const { fixture } = await setup();

    expect(fixture.nativeElement.querySelector(".segmented")).toBeNull();
    expect(fixture.nativeElement.querySelector(".panel-title").textContent).toContain(
      "Charts",
    );
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
