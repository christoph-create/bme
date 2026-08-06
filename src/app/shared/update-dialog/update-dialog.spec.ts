import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";

import { AvailableRelease } from "../../core/models/update-check.model";
import { UpdateDialog } from "./update-dialog";

function release(overrides: Partial<AvailableRelease> = {}): AvailableRelease {
  return {
    version: "0.8.0",
    name: "v0.8.0",
    notes: "Fixed the thing",
    url: "https://github.com/christoph-create/bme/releases/tag/v0.8.0",
    published_at: "2026-08-01T00:00:00Z",
    is_newer: true,
    is_skipped: false,
    ...overrides,
  };
}

@Component({
  imports: [UpdateDialog],
  template: `
    <app-update-dialog
      [release]="release()"
      currentVersion="0.7.0"
      (opened)="onOpen()"
      (dismissed)="onDismiss()"
      (skipped)="onSkip()"
    />
  `,
})
class HostComponent {
  readonly release = signal(release());
  onOpen = vi.fn();
  onDismiss = vi.fn();
  onSkip = vi.fn();
}

async function setup() {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture, host: fixture.componentInstance };
}

type Fixture = Awaited<ReturnType<typeof setup>>["fixture"];

function query(fixture: Fixture, selector: string): HTMLElement {
  const element = (fixture.nativeElement as HTMLElement).querySelector(selector);
  if (!element) throw new Error(`no element matching ${selector}`);
  return element as HTMLElement;
}

describe("UpdateDialog", () => {
  it("shows both version numbers", async () => {
    const { fixture } = await setup();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("0.8.0");
    expect(text).toContain("You're on 0.7.0");
  });

  it("shows the release notes", async () => {
    const { fixture } = await setup();

    expect(query(fixture, ".notes").textContent).toContain("Fixed the thing");
  });

  it("falls back to a message when there are no release notes", async () => {
    const { fixture, host } = await setup();
    host.release.set(release({ notes: null }));
    fixture.detectChanges();

    expect(query(fixture, ".notes").textContent).toContain(
      "No release notes for this version.",
    );
  });

  it("renders release notes as text and never as markup", async () => {
    const { fixture, host } = await setup();
    host.release.set(release({ notes: "<b>bold</b> and <script>bad()</script>" }));
    fixture.detectChanges();

    const notes = query(fixture, ".notes");
    expect(notes.textContent).toContain("<b>bold</b>");
    expect(notes.querySelector("b")).toBeNull();
    expect(notes.querySelector("script")).toBeNull();
  });

  it("emits opened only from the Open on GitHub button", async () => {
    const { fixture, host } = await setup();

    query(fixture, ".btn-primary").click();

    expect(host.onOpen).toHaveBeenCalledOnce();
    expect(host.onDismiss).not.toHaveBeenCalled();
    expect(host.onSkip).not.toHaveBeenCalled();
  });

  it("emits skipped only from the Skip this version button", async () => {
    const { fixture, host } = await setup();

    query(fixture, ".btn-quiet").click();

    expect(host.onSkip).toHaveBeenCalledOnce();
    expect(host.onOpen).not.toHaveBeenCalled();
    expect(host.onDismiss).not.toHaveBeenCalled();
  });

  it("emits dismissed only from the Remind me later button", async () => {
    const { fixture, host } = await setup();

    query(fixture, ".btn-secondary").click();

    expect(host.onDismiss).toHaveBeenCalledOnce();
    expect(host.onSkip).not.toHaveBeenCalled();
  });

  it("treats every way of dismissing as dismissing, never as skipping", async () => {
    const { fixture, host } = await setup();

    query(fixture, ".backdrop").click();
    query(fixture, ".close-button").click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(host.onDismiss).toHaveBeenCalledTimes(3);
    expect(host.onSkip).not.toHaveBeenCalled();
    expect(host.onOpen).not.toHaveBeenCalled();
  });
});
