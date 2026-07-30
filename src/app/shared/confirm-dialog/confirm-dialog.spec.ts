import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "./confirm-dialog";

@Component({
  imports: [ConfirmDialog],
  template: `
    <app-confirm-dialog
      title="Clear retained message"
      message="Publish an empty retained message to sensors/temp?"
      detail="This affects every client."
      confirmLabel="Clear retained"
      (confirmed)="onConfirm()"
      (cancelled)="onCancel()"
    />
  `,
})
class HostComponent {
  onConfirm = vi.fn();
  onCancel = vi.fn();
}

async function setup() {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture, host: fixture.componentInstance };
}

function query(
  fixture: Awaited<ReturnType<typeof setup>>["fixture"],
  selector: string,
): HTMLElement | null {
  return (fixture.nativeElement as HTMLElement).querySelector(selector);
}

describe("ConfirmDialog", () => {
  it("shows the title, message, detail and confirm label", async () => {
    const { fixture } = await setup();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";

    expect(text).toContain("Clear retained message");
    expect(text).toContain("Publish an empty retained message to sensors/temp?");
    expect(text).toContain("This affects every client.");
    expect(query(fixture, ".btn-danger")?.textContent?.trim()).toBe(
      "Clear retained",
    );
  });

  it("confirms only when the danger button is pressed", async () => {
    const { fixture, host } = await setup();

    (query(fixture, ".btn-danger") as HTMLElement).click();

    expect(host.onConfirm).toHaveBeenCalledOnce();
    expect(host.onCancel).not.toHaveBeenCalled();
  });

  it("cancels on the Cancel button", async () => {
    const { fixture, host } = await setup();

    (query(fixture, ".btn-secondary") as HTMLElement).click();

    expect(host.onCancel).toHaveBeenCalledOnce();
    expect(host.onConfirm).not.toHaveBeenCalled();
  });

  it("treats dismissing the dialog as cancelling, never as confirming", async () => {
    const { fixture, host } = await setup();

    (query(fixture, ".backdrop") as HTMLElement).click();
    (query(fixture, ".close-button") as HTMLElement).click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(host.onCancel).toHaveBeenCalledTimes(3);
    expect(host.onConfirm).not.toHaveBeenCalled();
  });
});
