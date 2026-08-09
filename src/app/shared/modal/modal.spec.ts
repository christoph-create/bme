import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

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

// Modal tracks the open stack in module scope so only the topmost handles
// Escape. Fixtures aren't torn down between specs by default, so without this
// a modal from an earlier test stays "open" and owns the keypress.
afterEach(() => {
  TestBed.resetTestingModule();
});

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

@Component({
  imports: [Modal],
  template: `
    <app-modal title="Outer" (close_modal)="onOuterClose()">
      @if (innerOpen()) {
        <app-modal title="Inner" (close_modal)="onInnerClose()">
          <p>nested</p>
        </app-modal>
      }
    </app-modal>
  `,
})
class NestedHostComponent {
  readonly innerOpen = signal(true);
  onOuterClose = vi.fn();
  onInnerClose = vi.fn();
}

describe("Modal nesting", () => {
  async function setupNested() {
    TestBed.configureTestingModule({ imports: [NestedHostComponent] });
    const fixture = TestBed.createComponent(NestedHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return { fixture, host: fixture.componentInstance };
  }

  it("closes only the innermost modal on Escape", async () => {
    // Escape is a document listener, so without a stack both modals react to
    // the same keypress - and closing the variables editor opened from inside
    // the template form would take the half-finished template with it.
    const { host } = await setupNested();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(host.onInnerClose).toHaveBeenCalledOnce();
    expect(host.onOuterClose).not.toHaveBeenCalled();
  });

  it("hands Escape back to the outer modal once the inner one is gone", async () => {
    const { fixture, host } = await setupNested();
    host.innerOpen.set(false);
    fixture.detectChanges();
    await fixture.whenStable();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(host.onOuterClose).toHaveBeenCalledOnce();
    expect(host.onInnerClose).not.toHaveBeenCalled();
  });
});
