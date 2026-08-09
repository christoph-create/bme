import {
  Component,
  DestroyRef,
  HostListener,
  computed,
  inject,
  signal,
  viewChild,
} from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";

import { BrokerConnection } from "../../core/models/broker-connection.model";
import { MessageDraft } from "../../core/models/message-draft.model";
import { ConnectionsService } from "../../core/services/connections.service";
import { MqttEventsService } from "../../core/services/mqtt-events.service";
import { reconnectLabel } from "./format/reconnect-label";
import { MessageStream } from "./message-stream/message-stream";
import { PublishPanel } from "./publish-panel/publish-panel";
import { SubscriptionsPanel } from "./subscriptions-panel/subscriptions-panel";
import { ToolPanel } from "./tool-panel/tool-panel";
import { TopicTree } from "./topic-tree/topic-tree";

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 1200;
const MIN_PUBLISH_HEIGHT = 200;
const MAX_PUBLISH_HEIGHT = 560;
const MIN_TOOL_PANEL_WIDTH = 240;
const MAX_TOOL_PANEL_WIDTH = 900;
const DEFAULT_SIDEBAR_WIDTH = 260;
const DEFAULT_PUBLISH_HEIGHT = 260;
const DEFAULT_TOOL_PANEL_WIDTH = 360;
/** How little the message stream may be squeezed to before the side panels
 * stop growing. Without it, a wide sidebar plus a wide tool panel can leave
 * the stream at zero with no way to drag it back. */
const MIN_MESSAGES_WIDTH = 320;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

type ResizeMode = "column" | "row" | "tool" | null;

/** What the backend is currently attempting, per its `Reconnecting` events. */
interface ReconnectState {
  attempt: number;
  maxAttempts: number;
}

@Component({
  selector: "app-broker-workspace",
  imports: [
    SubscriptionsPanel,
    TopicTree,
    MessageStream,
    PublishPanel,
    ToolPanel,
  ],
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
  readonly reconnecting = signal<ReconnectState | null>(null);
  // Reconnecting counts as "not connected": there's no session to publish
  // over, and the backend drops anything sent during the backoff.
  readonly connected = computed(
    () =>
      !this.connecting() &&
      !this.connectError() &&
      this.reconnecting() === null,
  );
  readonly reconnectLabel = reconnectLabel;
  readonly selectedTopic = signal<string | null>(null);
  readonly connection = signal<BrokerConnection | null>(null);

  /** Owned here rather than in the message stream because the charts freeze
   * on it too. The stream still writes to it - it clears the pause when the
   * selected topic changes. */
  readonly paused = signal(false);

  private readonly publishPanel = viewChild(PublishPanel);

  /** Hands a message the user asked to resend straight to the publish panel.
   * A direct method call rather than an input, because resending the *same*
   * message twice has to reload the draft both times - an input signal
   * wouldn't fire again for an unchanged reference. */
  loadDraft(draft: MessageDraft): void {
    this.publishPanel()?.loadDraft(draft);
  }

  /** Double-clicking a topic in the tree is the only thing that points the
   * publish panel at it - a plain click just opens the stream, so browsing
   * topics never clobbers a publish topic the user typed. Imperative for the
   * same reason as `loadDraft`. */
  setPublishTopic(topic: string): void {
    this.publishPanel()?.setTopic(topic);
  }

  toggleToolPanel(): void {
    this.toolPanelOpen.update((open) => !open);
    // Leaving the panel expanded while closed would make the next open jump
    // straight over the message stream, which is never what a plain reopen
    // is asking for.
    if (!this.toolPanelOpen()) {
      this.toolPanelExpanded.set(false);
    }
  }

  toggleToolPanelExpanded(): void {
    this.toolPanelExpanded.update((expanded) => !expanded);
  }

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
  private readonly toolPanelWidthFraction = signal(
    DEFAULT_TOOL_PANEL_WIDTH / window.innerWidth,
  );

  // Collapsed is a separate flag rather than a zero fraction: the minimum
  // clamp below would immediately pull a zero back up to MIN_TOOL_PANEL_WIDTH.
  // Keeping the fraction untouched also means reopening restores the width
  // the user last dragged to.
  readonly toolPanelOpen = signal(false);

  /** Expanded over the message stream's column. The sidebar and the publish
   * panel are untouched - this trades the message list for chart room, not
   * the whole workspace. */
  readonly toolPanelExpanded = signal(false);

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
  readonly toolPanelWidth = computed(() => {
    // Depends on the sidebar as well as the window, so widening the sidebar
    // squeezes the tool panel rather than the message stream.
    const available =
      this.windowWidth() - this.sidebarWidth() - MIN_MESSAGES_WIDTH;
    return clamp(
      this.toolPanelWidthFraction() * this.windowWidth(),
      MIN_TOOL_PANEL_WIDTH,
      Math.max(MIN_TOOL_PANEL_WIDTH, Math.min(MAX_TOOL_PANEL_WIDTH, available)),
    );
  });

  readonly gridTemplateColumns = computed(() => {
    const sidebar = `${this.sidebarWidth()}px 6px`;
    if (!this.toolPanelOpen()) {
      return `${sidebar} 1fr 0 0`;
    }
    // Expanded, the messages column and its splitter go to zero and the panel
    // takes the `1fr`. Keeping all five tracks in every state is what lets
    // `.publish` span `3 / 6` without any CSS branching.
    if (this.toolPanelExpanded()) {
      return `${sidebar} 0 0 1fr`;
    }
    return `${sidebar} 1fr 6px ${this.toolPanelWidth()}px`;
  });

  /** Hidden rather than merely zero-width, so the stream isn't re-measuring
   * and re-wrapping 500 cards behind a panel nobody can see through. */
  readonly messagesHidden = computed(
    () => this.toolPanelOpen() && this.toolPanelExpanded(),
  );

  readonly toolSplitterVisible = computed(
    () => this.toolPanelOpen() && !this.toolPanelExpanded(),
  );

  readonly resizing = signal<ResizeMode>(null);

  private dragOrigin = {
    x: 0,
    y: 0,
    sidebarWidth: 0,
    publishHeight: 0,
    toolPanelWidth: 0,
  };

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
          this.reconnecting.set(null);
        }
      } else if ("Reconnecting" in event) {
        if (event.Reconnecting.connection_id === this.connectionId) {
          this.connecting.set(false);
          this.connectError.set(null);
          this.reconnecting.set({
            attempt: event.Reconnecting.attempt,
            maxAttempts: event.Reconnecting.max_attempts,
          });
        }
      } else if ("Disconnected" in event) {
        // Also the "gave up retrying" path - the backend only sends this once
        // the attempt budget is spent, so falling back to the plain error
        // banner with its Retry button is exactly right.
        if (event.Disconnected.connection_id === this.connectionId) {
          this.connecting.set(false);
          this.reconnecting.set(null);
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

  /**
   * Gives up on the retry loop without leaving the workspace, unlike
   * `disconnect()` below - the topic tree and message history you were
   * looking at stay on screen, and the Retry button on the error banner is
   * still there if you change your mind.
   */
  async stopReconnecting(): Promise<void> {
    try {
      await this.connectionsService.disconnect(this.connectionId);
    } catch (err) {
      this.connectError.set(err instanceof Error ? err.message : String(err));
    }
    // The backend's Disconnected event sets the same state; doing it here too
    // means a dropped event can't leave the spinner running forever.
    this.reconnecting.set(null);
    this.connecting.set(false);
    this.connectError.update((error) => error ?? "Disconnected from broker");
  }

  async connect(): Promise<void> {
    this.connecting.set(true);
    this.connectError.set(null);
    this.reconnecting.set(null);
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

  startResize(mode: Exclude<ResizeMode, null>, event: PointerEvent): void {
    event.preventDefault();
    this.resizing.set(mode);
    this.dragOrigin = {
      x: event.clientX,
      y: event.clientY,
      sidebarWidth: this.sidebarWidth(),
      publishHeight: this.publishHeight(),
      toolPanelWidth: this.toolPanelWidth(),
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
    } else if (mode === "tool") {
      // The handle is on the panel's left edge, so dragging right shrinks it -
      // the same inversion the publish splitter needs.
      const delta = event.clientX - this.dragOrigin.x;
      const width = clamp(
        this.dragOrigin.toolPanelWidth - delta,
        MIN_TOOL_PANEL_WIDTH,
        MAX_TOOL_PANEL_WIDTH,
      );
      this.toolPanelWidthFraction.set(width / this.windowWidth());
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
