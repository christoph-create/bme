import {
  Component,
  HostListener,
  OnInit,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from "@angular/core";
import { Router } from "@angular/router";

import { MqttVersion } from "../../core/models/broker-connection.model";
import { ComparePins } from "../../core/models/compare-pin.model";
import { MessageDraft } from "../../core/models/message-draft.model";
import { StoredMessage } from "../../core/models/stored-message.model";
import { ConnectionStatusService } from "../../core/services/connection-status.service";
import { WorkspacesService } from "../../core/services/workspaces.service";
import { isConnected } from "../../core/status/connection-status";
import { DockSide, DockToggle } from "../../shared/dock-toggle/dock-toggle";
import { Splitter } from "../../shared/splitter/splitter";
import { reconnectLabel } from "./format/reconnect-label";
import {
  DockFractions,
  DockId,
  LayoutInput,
  applyDrag,
  defaultFractions,
  dockSizesPx,
  gridColumns,
  gridRows,
  toolsIsWide,
} from "./layout/dock-layout";
import { MessageStream } from "./message-stream/message-stream";
import { PublishPanel } from "./publish-panel/publish-panel";
import { SubscriptionsPanel } from "./subscriptions-panel/subscriptions-panel";
import { togglePin } from "./tool-panel/compare/compare-pins";
import { ToolPanel } from "./tool-panel/tool-panel";
import { TopicTree } from "./topic-tree/topic-tree";

@Component({
  selector: "app-broker-workspace",
  imports: [
    SubscriptionsPanel,
    TopicTree,
    MessageStream,
    PublishPanel,
    ToolPanel,
    Splitter,
    DockToggle,
  ],
  templateUrl: "./broker-workspace.html",
  styleUrl: "./broker-workspace.css",
})
export class BrokerWorkspace implements OnInit {
  private readonly status = inject(ConnectionStatusService);
  private readonly workspaces = inject(WorkspacesService);
  private readonly router = inject(Router);

  readonly connectionId = input.required<string>();
  /** False while this workspace is a background tab. It stays mounted and
   * keeps working either way - a repeating publisher does not stop because you
   * looked at another broker. */
  readonly active = input(true);

  /** The one source of truth for this broker's state; the workspace only
   * reads it and asks the service to act. */
  readonly connectionStatus = computed(() =>
    this.status.statusOf(this.connectionId()),
  );
  readonly connected = computed(() => isConnected(this.connectionStatus()));
  /** Something that went wrong which the connection recovered from - an
   * oversize message, typically. Separate from the status because it stays
   * worth showing while the broker is connected and working. */
  readonly connectionWarning = computed(() =>
    this.status.warningOf(this.connectionId()),
  );
  readonly reconnectLabel = reconnectLabel;
  readonly selectedTopic = signal<string | null>(null);
  /** Fetched once when the tab opens, and shared with the tab bar. */
  readonly connection = computed(() =>
    this.workspaces.connectionFor(this.connectionId()),
  );
  /** Falls back to 3.1.1 while the connection is still loading, which only
   * ever hides the MQTT 5 controls for a moment rather than showing them
   * on a connection that turns out not to have them. */
  readonly protocolVersion = computed<MqttVersion>(
    () => this.connection()?.protocol_version ?? "v311",
  );

  /** Owned here rather than in the message stream because the charts freeze
   * on it too. The stream still writes to it - it clears the pause when the
   * selected topic changes. */
  readonly paused = signal(false);

  /** The messages frozen for the compare tool.
   *
   * Owned here rather than inside the tool because the tools dock defaults to
   * closed and its `@switch` destroys whichever tool is not showing - a pin
   * taken while the Charts tab is up would have nowhere to live. A plain
   * signal rather than a root service: both readers are descendants of this
   * long-lived component, so an input covers it without the per-connection
   * keying and cleanup a service would need. */
  readonly comparePins = signal<ComparePins | null>(null);

  private readonly publishPanel = viewChild(PublishPanel);
  private readonly toolPanel = viewChild(ToolPanel);

  /**
   * Pins a message the user asked to compare, and brings the tool into view.
   *
   * Two halves on purpose. The pin itself is *state*, so it travels down as
   * an input - re-pinning the same message is a no-op there by definition.
   * Revealing the tool is an *action* that has to happen on every click, even
   * when the pin did not change: pinning the baseline again while the Charts
   * tab is showing must still switch tabs. That is the same reason
   * `loadDraft` is a method call rather than an input.
   */
  pinForCompare(message: StoredMessage): void {
    const topic = this.selectedTopic();
    if (topic === null) {
      return;
    }
    this.comparePins.update((pins) =>
      togglePin(pins, topic, message, Date.now()),
    );
    this.toolPanel()?.selectTool("compare");
    this.openDock("tools");
  }

  clearComparePin(): void {
    this.comparePins.set(null);
  }


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

  private readonly windowWidth = signal(window.innerWidth);
  private readonly windowHeight = signal(window.innerHeight);
  private readonly fractions = signal<DockFractions>(
    defaultFractions(window.innerWidth, window.innerHeight),
  );

  /** The buttons in the header, in the order they appear there. Labels say
   * "panel" so they don't collide with the Publish button or the Tools tab
   * strip when something goes looking for a control by name. */
  readonly dockToggles: readonly {
    id: DockId;
    side: DockSide;
    label: string;
  }[] = [
    { id: "subscriptions", side: "left", label: "Subscriptions panel" },
    { id: "publish", side: "bottom", label: "Publish panel" },
    { id: "tools", side: "right", label: "Tools panel" },
  ];

  // Closed is a separate flag rather than a zero fraction: the minimum clamp
  // in `dockSizesPx` would immediately pull a zero back up, and keeping the
  // fraction untouched means reopening restores the size the user last
  // dragged to.
  readonly docksOpen = signal<Record<DockId, boolean>>({
    subscriptions: true,
    publish: true,
    tools: false,
  });

  toggleDock(dock: DockId): void {
    this.docksOpen.update((open) => ({ ...open, [dock]: !open[dock] }));
  }

  /** Idempotent, unlike `toggleDock`: revealing a tool must not close the
   * dock when it is already open. */
  private openDock(dock: DockId): void {
    if (this.docksOpen()[dock]) {
      return;
    }
    this.docksOpen.update((open) => ({ ...open, [dock]: true }));
  }

  private readonly layout = computed<LayoutInput>(() => ({
    windowWidth: this.windowWidth(),
    windowHeight: this.windowHeight(),
    fractions: this.fractions(),
    open: this.docksOpen(),
  }));

  readonly dockSizes = computed(() => dockSizesPx(this.layout()));
  readonly gridTemplateColumns = computed(() => gridColumns(this.layout()));
  readonly gridTemplateRows = computed(() => gridRows(this.layout()));

  /** Two columns of charts, once the dock has been given room for them. */
  readonly toolsWide = computed(
    () => this.docksOpen().tools && toolsIsWide(this.dockSizes().tools),
  );

  readonly resizing = signal<DockId | null>(null);

  private dragStartSize = 0;

  // Not the constructor: `connectionId` is an input, so it is only set by the
  // time this runs. Opening a tab is what connects.
  ngOnInit(): void {
    void this.connect();
  }

  /**
   * Gives up on the retry loop without leaving the workspace, unlike
   * `disconnect()` below - the topic tree and message history you were
   * looking at stay on screen, and the Retry button on the error banner is
   * still there if you change your mind.
   */
  stopReconnecting(): Promise<void> {
    return this.status.stopReconnecting(this.connectionId());
  }

  connect(): Promise<void> {
    return this.status.connect(this.connectionId());
  }

  dismissWarning(): void {
    this.status.dismissWarning(this.connectionId());
  }

  /**
   * Ends the session *and* closes the tab - one deliberate, labelled action
   * rather than two half-actions that can leave a dead tab behind.
   */
  async disconnect(): Promise<void> {
    try {
      await this.status.disconnect(this.connectionId());
    } catch {
      // Already recorded against the connection's status, which is what the
      // error banner reads; staying put is the point - there is still a live
      // session to try again on.
      return;
    }
    const next = this.workspaces.close(this.connectionId());
    void this.router.navigate(next ? ["/broker", next] : ["/connections"]);
  }

  startDrag(dock: DockId): void {
    this.resizing.set(dock);
    this.dragStartSize = this.dockSizes()[dock];
  }

  onDragged(dock: DockId, deltaPx: number): void {
    this.fractions.set(
      applyDrag(this.layout(), dock, deltaPx, this.dragStartSize),
    );
  }

  endDrag(): void {
    this.resizing.set(null);
  }

  // Keeps the splits proportional as the window is resized: every dock size is
  // derived from a stored fraction and this current size, so this just needs
  // to publish the new size - no incremental math that could drift or compound
  // across repeated events.
  @HostListener("window:resize")
  onWindowResize(): void {
    this.windowWidth.set(window.innerWidth);
    this.windowHeight.set(window.innerHeight);
  }
}
