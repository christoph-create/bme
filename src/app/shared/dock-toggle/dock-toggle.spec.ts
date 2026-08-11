import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";

import { DockSide, DockToggle } from "./dock-toggle";

function setup(side: DockSide = "left", label = "Subscriptions") {
  const fixture = TestBed.createComponent(DockToggle);
  fixture.componentRef.setInput("side", side);
  fixture.componentRef.setInput("label", label);
  fixture.detectChanges();

  const element = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    button: element.querySelector("button") as HTMLButtonElement,
    strip: element.querySelector(".strip") as SVGRectElement,
  };
}

describe("DockToggle", () => {
  it("asks for its dock to be toggled when clicked", () => {
    const { fixture, button } = setup();
    const toggled = vi.fn();
    fixture.componentInstance.toggled.subscribe(toggled);

    button.click();

    expect(toggled).toHaveBeenCalledTimes(1);
  });

  it("fills the edge of the icon its dock actually sits on", () => {
    expect(setup("left").strip.getAttribute("x")).toBe("1");
    expect(setup("right").strip.getAttribute("x")).toBe("9");

    const bottom = setup("bottom").strip;
    expect(bottom.getAttribute("y")).toBe("9");
    expect(bottom.getAttribute("width")).toBe("12");
  });

  it("announces its dock by name and its state as a pressed toggle", () => {
    const { fixture, button } = setup("right", "Tools");

    expect(button.getAttribute("aria-label")).toBe("Tools");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.title).toBe("Show Tools");

    fixture.componentRef.setInput("active", true);
    fixture.detectChanges();

    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.title).toBe("Hide Tools");
    expect(button.classList.contains("active")).toBe(true);
  });
});
