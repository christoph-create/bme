import {
  Component,
  DestroyRef,
  HostListener,
  computed,
  inject,
  signal,
} from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";

import { BrokerConnection } from "../../core/models/broker-connection.model";
import { ConnectionsService } from "../../core/services/connections.service";
import { MqttEventsService } from "../../core/services/mqtt-events.service";
import { MessageStream } from "./message-stream/message-stream";
import { PublishPanel } from "./publish-panel/publish-panel";
import { SubscriptionsPanel } from "./subscriptions-panel/subscriptions-panel";
import { TopicTree } from "./topic-tree/topic-tree";

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 1200;
const MIN_PUBLISH_HEIGHT = 200;
const MAX_PUBLISH_HEIGHT = 560;
const DEFAULT_SIDEBAR_WIDTH = 260;
const DEFAULT_PUBLISH_HEIGHT = 260;

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
  private readonly connectionsService = inject(ConnectionsService);
  private readonly mqttEvents = inject(MqttEventsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly connectionId = this.route.snapshot.paramMap.get("id") ?? "";

  readonly connecting = signal(true);
  readonly connectError = signal<string | null>(null);
  readonly selectedTopic = signal<string | null>(null);
  readonly connection = signal<BrokerConnection | null>(null);

  // The size of each window-relative panel is stored as a fraction of the
  // window's current dimensions (not a pixel value that gets nudged around
  // on every resize event) so that recomputing it after a window resize is
  // a pure `fraction * windowSize` read - never an incremental adjustment
  // that could drift or compound across repeated resize events.
  private readonly windowWidth = signal(window.innerWidth);
  private readonly windowHeight = signal(window.innerHeight);
  private readonly sidebarWidthFraction = signal(
    DEFAULT_SIDEBAR_WIDTH / window.innerWidth,
  );
  private readonly publishHeightFraction = signal(
    DEFAULT_PUBLISH_HEIGHT / window.innerHeight,
  );

  readonly sidebarWidth = computed(() =>
    clamp(
      this.sidebarWidthFraction() * this.windowWidth(),
      MIN_SIDEBAR_WIDTH,
      MAX_SIDEBAR_WIDTH,
    ),
  );
  readonly publishHeight = computed(() =>
    clamp(
      this.publishHeightFraction() * this.windowHeight(),
      MIN_PUBLISH_HEIGHT,
      MAX_PUBLISH_HEIGHT,
    ),
  );
  readonly resizing = signal<ResizeMode>(null);

  private dragOrigin = { x: 0, y: 0, sidebarWidth: 0, publishHeight: 0 };

  constructor() {
    // The `connect` command only confirms the broker accepted the request,
    // not that a session actually exists - and the broker can also drop an
    // established session later on. `Connected`/`Disconnected` events are
    // the only source of truth for that, so status must always follow them
    // rather than the initial connect() call resolving.
    const subscription = this.mqttEvents.events$.subscribe((event) => {
      if ("Connected" in event) {
        if (event.Connected.connection_id === this.connectionId) {
          this.connecting.set(false);
          this.connectError.set(null);
        }
      } else if ("Disconnected" in event) {
        if (event.Disconnected.connection_id === this.connectionId) {
          this.connecting.set(false);
          this.connectError.set("Disconnected from broker");
        }
      }
    });
    this.destroyRef.onDestroy(() => subscription.unsubscribe());

    void this.connect();
    void this.loadConnection();
  }

  private async loadConnection(): Promise<void> {
    try {
      this.connection.set(await this.connectionsService.get(this.connectionId));
    } catch {
      // Non-fatal: the header just falls back to a generic title. The
      // connect()/event-listener flow above is what surfaces real
      // connection problems.
    }
  }

  async connect(): Promise<void> {
    this.connecting.set(true);
    this.connectError.set(null);
    try {
      await this.connectionsService.connect(this.connectionId);
      // Leave `connecting` true - it clears when the Connected event above
      // arrives (or Disconnected, if the attempt fails asynchronously).
    } catch (err) {
      this.connectError.set(err instanceof Error ? err.message : String(err));
      this.connecting.set(false);
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.connectionsService.disconnect(this.connectionId);
    } catch (err) {
      this.connectError.set(err instanceof Error ? err.message : String(err));
      return;
    }
    void this.router.navigate(["/connections"]);
  }

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
      const width = clamp(
        this.dragOrigin.sidebarWidth + delta,
        MIN_SIDEBAR_WIDTH,
        MAX_SIDEBAR_WIDTH,
      );
      this.sidebarWidthFraction.set(width / this.windowWidth());
    } else if (mode === "row") {
      const delta = event.clientY - this.dragOrigin.y;
      const height = clamp(
        this.dragOrigin.publishHeight - delta,
        MIN_PUBLISH_HEIGHT,
        MAX_PUBLISH_HEIGHT,
      );
      this.publishHeightFraction.set(height / this.windowHeight());
    }
  }

  @HostListener("document:pointerup")
  onPointerUp(): void {
    this.resizing.set(null);
  }

  // Keeps the split proportional as the window is resized: sidebarWidth and
  // publishHeight are computed signals derived from the stored fraction and
  // this current size, so this just needs to publish the new size - no
  // incremental math that could drift or compound across repeated events.
  @HostListener("window:resize")
  onWindowResize(): void {
    this.windowWidth.set(window.innerWidth);
    this.windowHeight.set(window.innerHeight);
  }
}
