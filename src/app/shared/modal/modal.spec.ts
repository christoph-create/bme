import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";

import { Modal } from "./modal";

@Component({
  imports: [Modal],
  template: `
    <app-modal title="Test Modal" (close_modal)="onClose()">
      <p class="body-content">Hello</p>
    </app-modal>
  `,
})
class HostComponent {
  onClose = vi.fn();
}

async function setup() {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture, host: fixture.componentInstance };
}

function query(fixture: Awaited<ReturnType<typeof setup>>["fixture"], selector: string): HTMLElement | null {
  return (fixture.nativeElement as HTMLElement).querySelector(selector);
}

describe("Modal", () => {
  it("renders the title and projects body content", async () => {
    const { fixture } = await setup();

    expect(query(fixture, ".panel-header")?.textContent).toContain("Test Modal");
    expect(query(fixture, ".body-content")?.textContent).toBe("Hello");
  });

  it("emits close when the close button is clicked", async () => {
    const { fixture, host } = await setup();

    (query(fixture, ".close-button") as HTMLElement).click();

    expect(host.onClose).toHaveBeenCalledOnce();
  });

  it("emits close when the backdrop is clicked", async () => {
    const { fixture, host } = await setup();

    (query(fixture, ".backdrop") as HTMLElement).click();

    expect(host.onClose).toHaveBeenCalledOnce();
  });

  it("does not emit close when the panel itself is clicked", async () => {
    const { fixture, host } = await setup();

    (query(fixture, ".panel") as HTMLElement).click();

    expect(host.onClose).not.toHaveBeenCalled();
  });

  it("emits close when Escape is pressed", async () => {
    const { host } = await setup();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(host.onClose).toHaveBeenCalledOnce();
  });
});
