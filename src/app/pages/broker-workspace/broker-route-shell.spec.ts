import { TestBed } from "@angular/core/testing";
import { ActivatedRoute, convertToParamMap } from "@angular/router";
import { BehaviorSubject } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { ConnectionsService } from "../../core/services/connections.service";
import { MessageStoreService } from "../../core/services/message-store.service";
import { ValueChartsService } from "../../core/services/value-charts.service";
import { WorkspacesService } from "../../core/services/workspaces.service";
import { BrokerRouteShell } from "./broker-route-shell";

const A = "aaaaaaaa-1111-1111-1111-111111111111";
const B = "bbbbbbbb-2222-2222-2222-222222222222";

function setup(id: string = A) {
  const paramMap = new BehaviorSubject(convertToParamMap({ id }));

  TestBed.configureTestingModule({
    imports: [BrokerRouteShell],
    providers: [
      { provide: ConnectionsService, useValue: { get: vi.fn() } },
      { provide: MessageStoreService, useValue: { clear: vi.fn() } },
      { provide: ValueChartsService, useValue: { removeAllFor: vi.fn() } },
      { provide: ActivatedRoute, useValue: { paramMap } },
    ],
  });

  const workspaces = TestBed.inject(WorkspacesService);
  const fixture = TestBed.createComponent(BrokerRouteShell);
  fixture.detectChanges();

  return { fixture, workspaces, paramMap };
}

describe("BrokerRouteShell", () => {
  it("opens and shows the workspace named in the URL", () => {
    const { workspaces } = setup();

    expect(workspaces.openIds()).toEqual([A]);
    expect(workspaces.activeId()).toBe(A);
  });

  /** Angular reuses this component when navigating between two broker ids, so
   * reading the id from a snapshot would leave the first one showing. */
  it("follows the URL to another broker without being rebuilt", () => {
    const { workspaces, paramMap } = setup();

    paramMap.next(convertToParamMap({ id: B }));

    expect(workspaces.openIds()).toEqual([A, B]);
    expect(workspaces.activeId()).toBe(B);
  });

  it("hides the workspaces on the way out without closing them", () => {
    const { fixture, workspaces } = setup();

    fixture.destroy();

    expect(workspaces.activeId()).toBeNull();
    expect(workspaces.openIds()).toEqual([A]);
  });
});
