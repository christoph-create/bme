import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import { LineDiff, diffLines } from "./line-diff";
import { LineDiffView } from "./line-diff-view";

async function setup(diff: LineDiff) {
  TestBed.configureTestingModule({ imports: [LineDiffView] });
  const fixture = TestBed.createComponent(LineDiffView);
  fixture.componentRef.setInput("diff", diff);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture };
}

describe("LineDiffView", () => {
  it("shows a hunk header, so a gap reads as unchanged lines", async () => {
    const { fixture } = await setup(diffLines("a\nb\nc", "a\nB\nc"));
    expect(
      fixture.nativeElement.querySelector(".hunk-header").textContent.trim(),
    ).toBe("@@ -1,3 +1,3 @@");
  });

  it("marks added and removed lines", async () => {
    const { fixture } = await setup(diffLines("a\nb", "a\nB"));
    const lines = [...fixture.nativeElement.querySelectorAll(".line")];
    expect(
      lines.map((line: HTMLElement) =>
        line.classList.contains("added")
          ? "added"
          : line.classList.contains("removed")
            ? "removed"
            : "context",
      ),
    ).toEqual(["context", "removed", "added"]);
  });

  it("renders one hunk per separated change", async () => {
    const before = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const after = before
      .replace("line 2", "LINE 2")
      .replace("line 25", "LINE 25");
    const { fixture } = await setup(diffLines(before, after));
    expect(fixture.nativeElement.querySelectorAll(".hunk")).toHaveLength(2);
  });

  it("makes a stray carriage return visible", async () => {
    const { fixture } = await setup(diffLines("a\r\nb", "a\nb"));
    const texts = [...fixture.nativeElement.querySelectorAll(".text")].map(
      (text: HTMLElement) => text.textContent,
    );
    expect(texts).toContain("a␍");
  });

  it("says a payload was too large rather than showing an empty diff", async () => {
    const huge = "x".repeat(70_000);
    const { fixture } = await setup(diffLines(huge, `${huge}y`));
    expect(fixture.nativeElement.querySelector(".too-large")).toBeTruthy();
    expect(fixture.nativeElement.querySelector(".hunk")).toBeNull();
  });
});
