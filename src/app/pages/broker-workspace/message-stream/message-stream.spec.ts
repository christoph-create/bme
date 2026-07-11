import { ComponentFixture, TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";

import { MessageStream } from "./message-stream";

describe("MessageStream", () => {
  let component: MessageStream;
  let fixture: ComponentFixture<MessageStream>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MessageStream],
    }).compileComponents();

    fixture = TestBed.createComponent(MessageStream);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it("should create", () => {
    expect(component).toBeTruthy();
  });
});
