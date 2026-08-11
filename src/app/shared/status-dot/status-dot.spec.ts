import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import { ConnectionStatus } from "../../core/status/connection-status";
import { StatusDot } from "./status-dot";

function setup(status: ConnectionStatus) {
  const fixture = TestBed.createComponent(StatusDot);
  fixture.componentRef.setInput("status", status);
  fixture.detectChanges();

  return { fixture, host: fixture.nativeElement as HTMLElement };
}

describe("StatusDot", () => {
  it("carries the status's tone as its class", () => {
    expect(setup({ kind: "connected" }).host.classList).toContain("connected");
    expect(setup({ kind: "connecting" }).host.classList).toContain("pending");
    expect(
      setup({ kind: "reconnecting", attempt: 1, maxAttempts: 10 }).host
        .classList,
    ).toContain("pending");
    expect(
      setup({ kind: "disconnected", error: "boom" }).host.classList,
    ).toContain("error");
    expect(
      setup({ kind: "disconnected", error: null }).host.classList,
    ).toContain("idle");
  });

  it("says what it means, for a reader who cannot see the colour", () => {
    const { host } = setup({ kind: "connected" });

    expect(host.getAttribute("role")).toBe("img");
    expect(host.getAttribute("aria-label")).toBe("Connected");
    expect(host.title).toBe("Connected");
  });

  it("updates when the status changes", () => {
    const { fixture, host } = setup({ kind: "connecting" });

    fixture.componentRef.setInput("status", { kind: "connected" });
    fixture.detectChanges();

    expect(host.classList).toContain("connected");
    expect(host.classList).not.toContain("pending");
  });
});
