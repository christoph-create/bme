import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import { StatTile } from "./stat-tile";

async function setup(inputs: {
  label: string;
  value: string;
  hint?: string | null;
  series?: readonly number[];
}) {
  // Reset first, so a test can render more than one tile.
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [StatTile] });
  const fixture = TestBed.createComponent(StatTile);
  fixture.componentRef.setInput("label", inputs.label);
  fixture.componentRef.setInput("value", inputs.value);
  if (inputs.hint !== undefined) {
    fixture.componentRef.setInput("hint", inputs.hint);
  }
  if (inputs.series !== undefined) {
    fixture.componentRef.setInput("series", inputs.series);
  }
  fixture.detectChanges();
  return fixture;
}

describe("StatTile", () => {
  it("shows the label and the value it was given, formatted by someone else", async () => {
    const fixture = await setup({ label: "Messages in", value: "12,481" });

    expect(
      fixture.nativeElement.querySelector(".tile-label").textContent,
    ).toContain("Messages in");
    expect(
      fixture.nativeElement.querySelector(".tile-value").textContent,
    ).toContain("12,481");
  });

  /** A broker version string does not fit a 150px tile, and the reading is
   * no use half-shown. */
  it("keeps the full value reachable when it has to be ellipsed", async () => {
    const fixture = await setup({
      label: "Version",
      value: "mosquitto version 2.1.2",
    });

    expect(
      fixture.nativeElement.querySelector(".tile-value").getAttribute("title"),
    ).toBe("mosquitto version 2.1.2");
  });

  it("leaves the hint out when there isn't one", async () => {
    const fixture = await setup({ label: "Reconnects", value: "0" });

    expect(fixture.nativeElement.querySelector(".tile-hint")).toBeNull();
  });

  it("shows a hint when there is one", async () => {
    const fixture = await setup({
      label: "Payload in",
      value: "412 KB",
      hint: "payload bytes only",
    });

    expect(
      fixture.nativeElement.querySelector(".tile-hint").textContent,
    ).toContain("payload bytes only");
  });

  it("draws a sparkline once there are two readings to join", async () => {
    const fixture = await setup({
      label: "Messages in/s",
      value: "4.3/s",
      series: [1, 4, 2, 9],
    });

    expect(fixture.nativeElement.querySelector(".spark-line")).toBeTruthy();
  });

  /** A single reading is a dot, not a shape, and a flat empty row of zeros
   * says less than no chart at all. */
  it("draws nothing when there is no shape to draw", async () => {
    const one = await setup({ label: "Msg/s", value: "0/s", series: [3] });
    expect(one.nativeElement.querySelector(".spark")).toBeNull();

    const none = await setup({ label: "Msg/s", value: "0/s", series: [] });
    expect(none.nativeElement.querySelector(".spark")).toBeNull();
  });
});
