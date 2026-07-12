import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import { QosSelect } from "./qos-select";

async function setup(initial: "AtMostOnce" | "AtLeastOnce" | "ExactlyOnce" = "AtMostOnce") {
  TestBed.configureTestingModule({ imports: [QosSelect] });

  const fixture = TestBed.createComponent(QosSelect);
  fixture.componentRef.setInput("value", initial);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture };
}

describe("QosSelect", () => {
  it("renders all three QoS options", async () => {
    const { fixture } = await setup();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("Q0");
    expect(text).toContain("Q1");
    expect(text).toContain("Q2");
  });

  it("highlights the option matching the current value", async () => {
    const { fixture } = await setup("AtLeastOnce");

    const options = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(".qos-option"),
    );
    const selected = options.filter((el) => el.classList.contains("selected"));

    expect(selected).toHaveLength(1);
    expect(selected[0].textContent?.trim()).toBe("Q1");
  });

  it("clicking a different option updates the value", async () => {
    const { fixture } = await setup("AtMostOnce");

    fixture.componentInstance.select("ExactlyOnce");
    fixture.detectChanges();

    expect(fixture.componentInstance.value()).toBe("ExactlyOnce");
    const options = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(".qos-option"),
    );
    const selected = options.find((el) => el.classList.contains("selected"));
    expect(selected?.textContent?.trim()).toBe("Q2");
  });

  it("emits a value change when a different option is clicked (for two-way binding)", async () => {
    const { fixture } = await setup("AtMostOnce");
    const emitted: string[] = [];
    fixture.componentInstance.value.subscribe((v) => emitted.push(v));

    fixture.componentInstance.select("AtLeastOnce");

    expect(emitted).toEqual(["AtLeastOnce"]);
  });

  it("clicking an option in the DOM updates the selection", async () => {
    const { fixture } = await setup("AtMostOnce");
    const options = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(".qos-option"),
    );
    const q2 = options.find((el) => el.textContent?.trim() === "Q2");

    (q2 as HTMLElement).click();
    fixture.detectChanges();

    expect(fixture.componentInstance.value()).toBe("ExactlyOnce");
  });
});
