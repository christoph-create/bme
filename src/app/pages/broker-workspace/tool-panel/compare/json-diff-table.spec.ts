import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import { JsonDiffTable } from "./json-diff-table";
import { JsonDiffRow, diffJson, groupDiffRows } from "./json-diff";

async function setup(rows: readonly JsonDiffRow[], wide = false) {
  TestBed.configureTestingModule({ imports: [JsonDiffTable] });
  const fixture = TestBed.createComponent(JsonDiffTable);
  fixture.componentRef.setInput("rows", rows);
  fixture.componentRef.setInput("wide", wide);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture };
}

function rowsFor(before: unknown, after: unknown): readonly JsonDiffRow[] {
  return groupDiffRows(diffJson(before, after).rows);
}

describe("JsonDiffTable", () => {
  it("marks changed, added and removed rows", async () => {
    const { fixture } = await setup(
      rowsFor({ temp: 21.5, lastError: "E07" }, { temp: 21.8, status: "ok" }),
    );
    const markers = [
      ...fixture.nativeElement.querySelectorAll(".diff-row .marker"),
    ].map((marker: HTMLElement) => marker.textContent?.trim());
    expect(markers).toEqual(["~", "+", "-"]);
  });

  it("shows both values of a changed field", async () => {
    const { fixture } = await setup(rowsFor({ temp: 21.5 }, { temp: 21.8 }));
    const row = fixture.nativeElement.querySelector(".diff-row");
    expect(row.querySelector(".before").textContent.trim()).toBe("21.5");
    expect(row.querySelector(".after").textContent.trim()).toBe("21.8");
  });

  it("says so out loud when the type changed too", async () => {
    const { fixture } = await setup(rowsFor({ level: 81 }, { level: "81" }));
    expect(fixture.nativeElement.querySelector(".type-note")).toBeTruthy();
  });

  it("hides unchanged fields behind a count", async () => {
    const { fixture } = await setup(
      rowsFor({ a: 1, b: 2, c: 3 }, { a: 9, b: 2, c: 3 }),
    );
    const toggle = fixture.nativeElement.querySelector(".unchanged-toggle");
    expect(toggle.textContent.trim()).toBe("2 unchanged fields");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(fixture.nativeElement.querySelector(".rows.unchanged")).toBeNull();
  });

  it("expands the unchanged fields when the count is clicked", async () => {
    const { fixture } = await setup(
      rowsFor({ a: 1, b: 2, c: 3 }, { a: 9, b: 2, c: 3 }),
    );
    const toggle = fixture.nativeElement.querySelector(".unchanged-toggle");
    toggle.click();
    fixture.detectChanges();

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent.trim()).toBe("Hide 2 unchanged fields");
    expect(
      fixture.nativeElement.querySelectorAll(".rows.unchanged .diff-row"),
    ).toHaveLength(2);
  });

  it("says field rather than fields for a single unchanged one", async () => {
    const { fixture } = await setup(rowsFor({ a: 1, b: 2 }, { a: 9, b: 2 }));
    expect(
      fixture.nativeElement.querySelector(".unchanged-toggle").textContent.trim(),
    ).toBe("1 unchanged field");
  });

  it("offers no toggle when nothing is unchanged", async () => {
    const { fixture } = await setup(rowsFor({ a: 1 }, { a: 2 }));
    expect(fixture.nativeElement.querySelector(".unchanged-toggle")).toBeNull();
  });

  /** The dock's 240px floor cannot fit a path and two value columns, so the
   * three-column layout waits until the workspace says there is room. */
  it("stacks the values under the path until the dock is wide", async () => {
    const { fixture } = await setup(rowsFor({ a: 1 }, { a: 2 }), false);
    expect(
      fixture.nativeElement.querySelector(".diff-row").classList.contains("wide"),
    ).toBe(false);
  });

  it("takes the three-column layout once the dock is wide", async () => {
    const { fixture } = await setup(rowsFor({ a: 1 }, { a: 2 }), true);
    expect(
      fixture.nativeElement.querySelector(".diff-row").classList.contains("wide"),
    ).toBe(true);
  });

  it("names each row's kind for a screen reader, since the glyph is hidden", async () => {
    const { fixture } = await setup(rowsFor({ a: 1 }, { a: 2 }));
    const row = fixture.nativeElement.querySelector(".diff-row");
    expect(row.querySelector(".marker").getAttribute("aria-hidden")).toBe("true");
    expect(row.querySelector(".visually-hidden").textContent.trim()).toBe(
      "changed",
    );
  });
});
