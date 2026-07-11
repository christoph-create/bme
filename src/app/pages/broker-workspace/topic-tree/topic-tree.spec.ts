import { ComponentFixture, TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";

import { TopicTree } from "./topic-tree";

describe("TopicTree", () => {
  let component: TopicTree;
  let fixture: ComponentFixture<TopicTree>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TopicTree],
    }).compileComponents();

    fixture = TestBed.createComponent(TopicTree);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it("should create", () => {
    expect(component).toBeTruthy();
  });
});
