import { NgTemplateOutlet } from "@angular/common";
import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from "@angular/core";

import { MessageStoreService } from "../../../core/services/message-store.service";
import {
  TopicNode,
  buildTopicTree,
  collectFolderPaths,
  countLeaves,
} from "./build-topic-tree";
import { findUpdatedLeafPaths } from "./find-updated-leaf-paths";
import { formatPayloadPreview } from "./payload-preview";
import { formatTimeAgo } from "./time-ago";

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
  readonly topicSelected = output<string>();

  private readonly messageStore = inject(MessageStoreService);
  private readonly destroyRef = inject(DestroyRef);

  readonly nodes = signal<TopicNode[]>([]);
  readonly expandedPaths = signal<ReadonlySet<string>>(new Set());
  readonly selectedTopic = signal<string | null>(null);
  readonly now = signal(Date.now());
  readonly flashingPaths = signal<ReadonlySet<string>>(new Set());

  private previousNodes: TopicNode[] | null = null;
  private readonly flashTimeouts = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  readonly totalTopics = computed(() => countLeaves(this.nodes()));
  private readonly folderPaths = computed(() =>
    collectFolderPaths(this.nodes()),
  );
  readonly isFullyExpanded = computed(() => {
    const folders = this.folderPaths();
    return (
      folders.length > 0 && folders.every((p) => this.expandedPaths().has(p))
    );
  });

  ngOnInit(): void {
    const subscription = this.messageStore
      .topicsFor(this.connectionId())
      .subscribe((topics) => {
        const nextNodes = buildTopicTree(topics);
        if (this.previousNodes !== null) {
          this.flashPaths(findUpdatedLeafPaths(this.previousNodes, nextNodes));
        }
        this.previousNodes = nextNodes;
        this.nodes.set(nextNodes);
      });
    this.destroyRef.onDestroy(() => {
      subscription.unsubscribe();
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
    return this.expandedPaths().has(path);
  }

  isFlashing(path: string): boolean {
    return this.flashingPaths().has(path);
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
    this.expandedPaths.set(
      this.isFullyExpanded() ? new Set() : new Set(this.folderPaths()),
    );
  }

  selectTopic(path: string): void {
    this.selectedTopic.set(path);
    this.topicSelected.emit(path);
  }

  timeAgo(receivedAt: number): string {
    return formatTimeAgo(this.now() - receivedAt);
  }

  payloadPreview(payload: readonly number[]): string {
    return formatPayloadPreview(payload);
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
