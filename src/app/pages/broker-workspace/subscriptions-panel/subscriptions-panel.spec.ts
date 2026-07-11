import { ComponentFixture, TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";

import { SubscriptionsPanel } from "./subscriptions-panel";

describe("SubscriptionsPanel", () => {
  let component: SubscriptionsPanel;
  let fixture: ComponentFixture<SubscriptionsPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SubscriptionsPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(SubscriptionsPanel);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it("should create", () => {
    expect(component).toBeTruthy();
  });
});
