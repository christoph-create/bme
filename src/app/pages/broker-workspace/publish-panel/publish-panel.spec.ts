import { ComponentFixture, TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";

import { PublishPanel } from "./publish-panel";

describe("PublishPanel", () => {
  let component: PublishPanel;
  let fixture: ComponentFixture<PublishPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PublishPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(PublishPanel);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it("should create", () => {
    expect(component).toBeTruthy();
  });
});
