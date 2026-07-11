import { Component, HostListener, signal } from "@angular/core";

import { MessageStream } from "./message-stream/message-stream";
import { PublishPanel } from "./publish-panel/publish-panel";
import { SubscriptionsPanel } from "./subscriptions-panel/subscriptions-panel";
import { TopicTree } from "./topic-tree/topic-tree";

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 420;
const MIN_PUBLISH_HEIGHT = 160;
const MAX_PUBLISH_HEIGHT = 560;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

type ResizeMode = "column" | "row" | null;

@Component({
  selector: "app-broker-workspace",
  imports: [SubscriptionsPanel, TopicTree, MessageStream, PublishPanel],
  templateUrl: "./broker-workspace.html",
  styleUrl: "./broker-workspace.css",
})
export class BrokerWorkspace {
  readonly sidebarWidth = signal(260);
  readonly publishHeight = signal(260);
  readonly resizing = signal<ResizeMode>(null);

  private dragOrigin = { x: 0, y: 0, sidebarWidth: 0, publishHeight: 0 };

  startColumnResize(event: PointerEvent): void {
    event.preventDefault();
    this.resizing.set("column");
    this.dragOrigin = {
      x: event.clientX,
      y: event.clientY,
      sidebarWidth: this.sidebarWidth(),
      publishHeight: this.publishHeight(),
    };
  }

  startRowResize(event: PointerEvent): void {
    event.preventDefault();
    this.resizing.set("row");
    this.dragOrigin = {
      x: event.clientX,
      y: event.clientY,
      sidebarWidth: this.sidebarWidth(),
      publishHeight: this.publishHeight(),
    };
  }

  @HostListener("document:pointermove", ["$event"])
  onPointerMove(event: PointerEvent): void {
    const mode = this.resizing();
    if (mode === "column") {
      const delta = event.clientX - this.dragOrigin.x;
      this.sidebarWidth.set(
        clamp(
          this.dragOrigin.sidebarWidth + delta,
          MIN_SIDEBAR_WIDTH,
          MAX_SIDEBAR_WIDTH,
        ),
      );
    } else if (mode === "row") {
      const delta = event.clientY - this.dragOrigin.y;
      this.publishHeight.set(
        clamp(
          this.dragOrigin.publishHeight - delta,
          MIN_PUBLISH_HEIGHT,
          MAX_PUBLISH_HEIGHT,
        ),
      );
    }
  }

  @HostListener("document:pointerup")
  onPointerUp(): void {
    this.resizing.set(null);
  }
}
