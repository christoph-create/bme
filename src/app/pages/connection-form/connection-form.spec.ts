import { ComponentFixture, TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";

import { ConnectionForm } from "./connection-form";

describe("ConnectionForm", () => {
  let component: ConnectionForm;
  let fixture: ComponentFixture<ConnectionForm>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConnectionForm],
    }).compileComponents();

    fixture = TestBed.createComponent(ConnectionForm);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it("should create", () => {
    expect(component).toBeTruthy();
  });
});
