import { ComponentFixture, TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";

import { BrokerWorkspace } from "./broker-workspace";

describe("BrokerWorkspace", () => {
  let component: BrokerWorkspace;
  let fixture: ComponentFixture<BrokerWorkspace>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BrokerWorkspace],
    }).compileComponents();

    fixture = TestBed.createComponent(BrokerWorkspace);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it("should create", () => {
    expect(component).toBeTruthy();
  });
});
