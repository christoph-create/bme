import { NgTemplateOutlet } from "@angular/common";
import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from "@angular/core";

import { MessageStoreService } from "../../../core/services/message-store.service";
import {
  TopicNode,
  buildTopicTree,
  collectFolderPaths,
  countLeaves,
} from "./build-topic-tree";
import { formatPayloadPreview } from "../format/payload-text";
import { formatTimeAgo } from "../format/time-ago";
import { filterTopicTree } from "./filter-topic-tree";
import { findUpdatedLeafPaths } from "./find-updated-leaf-paths";

const TICK_INTERVAL_MS = 1000;
const FLASH_DURATION_MS = 400;

@Component({
  selector: "app-topic-tree",
  imports: [NgTemplateOutlet],
  templateUrl: "./topic-tree.html",
  styleUrl: "./topic-tree.css",
})
export class TopicTree implements OnInit {
  readonly connectionId = input.required<string>();
  /** Whether the message stream currently has a topic open and can run its
   * own Ctrl+F search - when it can, this tree defers to it unless the
   * user's focus is actually inside the tree. See `onFindShortcut`. */
  readonly streamAvailable = input(false);
  readonly topicSelected = output<string>();
  readonly publishTopicRequested = output<string>();

  private readonly messageStore = inject(MessageStoreService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  readonly nodes = signal<TopicNode[]>([]);
  readonly expandedPaths = signal<ReadonlySet<string>>(new Set());
  readonly selectedTopic = signal<string | null>(null);
  readonly now = signal(Date.now());
  readonly flashingPaths = signal<ReadonlySet<string>>(new Set());
  readonly filter = signal("");
  readonly filterOpen = signal(false);
  readonly retainedTopics = signal<ReadonlySet<string>>(new Set());

  private readonly filterInput =
    viewChild<ElementRef<HTMLInputElement>>("filterInput");

  private previousNodes: TopicNode[] | null = null;
  private readonly flashTimeouts = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  /** Whether "expand all" is the standing intent, independent of which
   * folders exist right now - drives both the toggle label and whether
   * folders that show up later (including the very first ones, if this was
   * clicked while the tree was still empty) get swept in too, instead of
   * the click being a one-time snapshot of whatever existed at click time. */
  readonly allExpanded = signal(false);

  readonly filtering = computed(() => this.filter().trim() !== "");

  /** The tree as rendered. `nodes` stays the unfiltered truth so flashing,
   * "expand all" and the total count all keep describing the whole broker
   * rather than whatever the filter happens to leave standing. */
  readonly visibleNodes = computed(() =>
    filterTopicTree(this.nodes(), this.filter()),
  );

  readonly totalTopics = computed(() => countLeaves(this.nodes()));
  readonly matchedTopics = computed(() => countLeaves(this.visibleNodes()));
  private readonly folderPaths = computed(() =>
    collectFolderPaths(this.nodes()),
  );

  constructor() {
    // The input only exists in the DOM while the filter is open, so focusing
    // can't happen at the moment it's opened - this waits for the view child
    // to actually show up.
    effect(() => {
      if (this.filterOpen()) {
        this.filterInput()?.nativeElement.focus();
      }
    });
  }

  ngOnInit(): void {
    const subscription = this.messageStore
      .topicsFor(this.connectionId())
      .subscribe((topics) => {
        const nextNodes = buildTopicTree(topics);
        if (this.allExpanded()) {
          this.expandNewFolders(nextNodes);
        }
        if (this.previousNodes !== null) {
          this.flashPaths(findUpdatedLeafPaths(this.previousNodes, nextNodes));
        }
        this.previousNodes = nextNodes;
        this.nodes.set(nextNodes);
      });
    const retainedSubscription = this.messageStore
      .retainedTopicsFor(this.connectionId())
      .subscribe((topics) => this.retainedTopics.set(topics));

    this.destroyRef.onDestroy(() => {
      subscription.unsubscribe();
      retainedSubscription.unsubscribe();
      for (const handle of this.flashTimeouts.values()) {
        clearTimeout(handle);
      }
    });

    const tickHandle = setInterval(
      () => this.now.set(Date.now()),
      TICK_INTERVAL_MS,
    );
    this.destroyRef.onDestroy(() => clearInterval(tickHandle));
  }

  isExpanded(path: string): boolean {
    // A filtered tree is fully open: everything still standing is there
    // because it matched, so collapsing it would hide the answer. Left as an
    // override rather than a write to `expandedPaths`, so clearing the filter
    // restores the user's own expand/collapse state verbatim.
    return this.filtering() || this.expandedPaths().has(path);
  }

  onFilterInput(event: Event): void {
    this.filter.set((event.target as HTMLInputElement).value);
  }

  clearFilter(): void {
    this.filter.set("");
    this.filterInput()?.nativeElement.focus();
  }

  openFilter(): void {
    this.filterOpen.set(true);
  }

  /** Closing always clears, so the tree is never narrowed by a filter the
   * user can no longer see. */
  closeFilter(): void {
    this.filterOpen.set(false);
    this.filter.set("");
  }

  toggleFilter(): void {
    if (this.filterOpen()) {
      this.closeFilter();
    } else {
      this.openFilter();
    }
  }

  /** Both this tree and the message stream bind Ctrl+F on `document`, so
   * both fire on every press - deferring here whenever the stream can
   * handle it and focus isn't actually inside the tree keeps the two from
   * opening at once. `MessageStream.onFindShortcut` carries the other half:
   * it defers back to this tree whenever focus is inside it. */
  @HostListener("document:keydown.control.f", ["$event"])
  onFindShortcut(event: Event): void {
    const target = event.target as Node | null;
    const focusInsideTree =
      target !== null && this.elementRef.nativeElement.contains(target);
    if (!focusInsideTree && this.streamAvailable()) {
      return;
    }
    event.preventDefault();
    this.openFilter();
  }

  isFlashing(path: string): boolean {
    return this.flashingPaths().has(path);
  }

  isRetained(path: string): boolean {
    return this.retainedTopics().has(path);
  }

  toggleFolder(path: string): void {
    const next = new Set(this.expandedPaths());
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    this.expandedPaths.set(next);
  }

  toggleExpandAll(): void {
    const next = !this.allExpanded();
    this.allExpanded.set(next);
    this.expandedPaths.set(next ? new Set(this.folderPaths()) : new Set());
  }

  selectTopic(path: string): void {
    this.selectedTopic.set(path);
    this.topicSelected.emit(path);
  }

  /** Double-click is a superset of click: the browser fires the single clicks
   * first, so the stream has already opened by the time this runs. */
  publishTopic(path: string): void {
    this.publishTopicRequested.emit(path);
  }

  timeAgo(receivedAt: number): string {
    return formatTimeAgo(this.now() - receivedAt);
  }

  payloadPreview(payload: readonly number[], payloadLen: number): string {
    return formatPayloadPreview(payload, payloadLen);
  }

  /** Adds any folder paths in `nextNodes` that weren't already present in
   * `this.previousNodes` to `expandedPaths` - only genuinely new folders,
   * so a folder the user manually collapsed by hand stays collapsed even
   * while the standing "expand all" intent is still in effect. */
  private expandNewFolders(nextNodes: TopicNode[]): void {
    const previousFolders = new Set(
      this.previousNodes ? collectFolderPaths(this.previousNodes) : [],
    );
    const newFolders = collectFolderPaths(nextNodes).filter(
      (path) => !previousFolders.has(path),
    );
    if (newFolders.length === 0) {
      return;
    }
    const next = new Set(this.expandedPaths());
    for (const path of newFolders) {
      next.add(path);
    }
    this.expandedPaths.set(next);
  }

  private flashPaths(paths: readonly string[]): void {
    for (const path of paths) {
      this.restartFlash(path);
    }
  }

  private restartFlash(path: string): void {
    const existingTimeout = this.flashTimeouts.get(path);
    if (existingTimeout !== undefined) {
      clearTimeout(existingTimeout);
      this.flashTimeouts.delete(path);
    }

    if (this.flashingPaths().has(path)) {
      // Already flashing: the [class.flash] binding only restarts the CSS
      // animation on a false->true transition, so drop the class for one
      // tick before re-adding it rather than leaving it a no-op "true".
      this.removeFromFlashing(path);
      setTimeout(() => this.addToFlashing(path), 0);
    } else {
      this.addToFlashing(path);
    }
  }

  private addToFlashing(path: string): void {
    const next = new Set(this.flashingPaths());
    next.add(path);
    this.flashingPaths.set(next);
    this.flashTimeouts.set(
      path,
      setTimeout(() => this.clearFlash(path), FLASH_DURATION_MS),
    );
  }

  private removeFromFlashing(path: string): void {
    const next = new Set(this.flashingPaths());
    next.delete(path);
    this.flashingPaths.set(next);
  }

  private clearFlash(path: string): void {
    this.removeFromFlashing(path);
    this.flashTimeouts.delete(path);
  }
}
