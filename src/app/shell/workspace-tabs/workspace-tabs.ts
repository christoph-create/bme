import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { NavigationEnd, Router } from "@angular/router";
import { filter, map } from "rxjs";

import { ConnectionStatusService } from "../../core/services/connection-status.service";
import { WorkspacesService } from "../../core/services/workspaces.service";
import {
  DRAG_THRESHOLD_PX,
  Slot,
  dragLayout,
} from "../../core/workspaces/reorder-tabs";
import { StatusDot } from "../../shared/status-dot/status-dot";

/** A press on a tab, from the moment it goes down until it is let go. */
interface Press {
  readonly connectionId: string;
  readonly startX: number;
  /** Pointer-to-tab-centre distance, so the tab is dragged from the point it
   * was grabbed by rather than snapping its middle under the cursor. */
  readonly grabOffset: number;
  dragging: boolean;
}

/**
 * One tab per open broker workspace, above the workspace's own header.
 *
 * There is deliberately no close button: a tab exists for as long as its
 * session does, and Disconnect is what ends both. That keeps "stop talking to
 * this broker" a single, labelled, deliberate action rather than something you
 * can do by aiming badly at a small ×.
 *
 * Broker tabs can be dragged along the strip to reorder them. The dragged tab
 * follows the pointer pixel for pixel while the others snap aside around it,
 * so the thing being moved is the thing under your hand. Home and the gear are
 * not part of the run and cannot be moved, displaced or dropped onto, since
 * both the drop slot and the reach of the drag come from the broker tabs
 * alone.
 *
 * The gear at the far end is the only way to reach Settings without leaving
 * the workspace, since the bar is the one piece of chrome that stays put.
 */
@Component({
  selector: "app-workspace-tabs",
  imports: [StatusDot],
  templateUrl: "./workspace-tabs.html",
  styleUrl: "./workspace-tabs.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    "(pointermove)": "onPointerMove($event)",
    "(pointerup)": "onPointerEnd($event)",
    "(pointercancel)": "onPointerEnd($event)",
  },
})
export class WorkspaceTabs {
  private readonly workspaces = inject(WorkspacesService);
  private readonly status = inject(ConnectionStatusService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly openIds = this.workspaces.openIds;
  readonly activeId = this.workspaces.activeId;

  /** The tab under an in-progress drag. The reorder itself happens live, in
   * the open-tab list; this only marks which tab is in hand. */
  readonly draggingId = signal<string | null>(null);
  /** How far that tab sits from the slot it currently occupies. */
  readonly dragOffset = signal(0);

  private press: Press | null = null;
  /** Set when a drag ends, to swallow the click that a browser may still
   * deliver to the tab it was let go over. */
  private suppressClick = false;

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  readonly onSettings = computed(() => this.url().startsWith("/settings"));
  // "No workspace showing" covers the settings page too, which has its own
  // button - so home only lights up for the remaining case, the broker list.
  readonly homeActive = computed(
    () => this.activeId() === null && !this.onSettings(),
  );

  readonly statusOf = this.status.statusOf.bind(this.status);

  nameOf(connectionId: string): string {
    return this.workspaces.connectionFor(connectionId)?.name ?? "Broker";
  }

  /** The shift that keeps a dragged tab under the pointer, and nothing for
   * every other tab - those sit where the layout puts them. */
  transformOf(connectionId: string): string | null {
    return this.draggingId() === connectionId
      ? `translateX(${this.dragOffset()}px)`
      : null;
  }

  activate(connectionId: string): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    void this.router.navigate(["/broker", connectionId]);
  }

  goHome(): void {
    void this.router.navigate(["/connections"]);
  }

  goSettings(): void {
    void this.router.navigate(["/settings"]);
  }

  onTabPointerDown(event: PointerEvent, connectionId: string): void {
    if (event.button !== 0) {
      return;
    }
    // A press always clears the flag before its own click can be judged by it,
    // so a swallowed click that never arrived cannot strand the next one.
    this.suppressClick = false;
    const tab = event.currentTarget as HTMLElement;
    this.press = {
      connectionId,
      startX: event.clientX,
      grabOffset: event.clientX - centerOf(tab),
      dragging: false,
    };
  }

  onPointerMove(event: PointerEvent): void {
    const press = this.press;
    if (!press) {
      return;
    }
    // The button is already up: the press ended somewhere we never heard
    // about, such as outside the window while the app was unfocused.
    if (event.buttons === 0) {
      this.onPointerEnd(event);
      return;
    }
    if (!press.dragging) {
      if (Math.abs(event.clientX - press.startX) < DRAG_THRESHOLD_PX) {
        return;
      }
      press.dragging = true;
      // Captured once the drag is real, and on the bar rather than the tab:
      // reordering moves the tab's own DOM node, which would drop a capture
      // held on it, and capturing a plain click would rob the button of it.
      this.host.nativeElement.setPointerCapture(event.pointerId);
      this.draggingId.set(press.connectionId);
    }

    const from = this.openIds().indexOf(press.connectionId);
    if (from === -1) {
      return;
    }
    const { toIndex, offset } = dragLayout(
      this.slots(from),
      event.clientX - press.grabOffset,
      from,
    );
    this.dragOffset.set(offset);
    if (toIndex !== from) {
      this.workspaces.reorder(from, toIndex);
    }
  }

  onPointerEnd(event: PointerEvent): void {
    const press = this.press;
    if (!press) {
      return;
    }
    this.press = null;
    this.draggingId.set(null);
    // Dropping the transform lets the tab slide into its slot; the CSS owns
    // how long that takes.
    this.dragOffset.set(0);
    if (!press.dragging) {
      return;
    }
    this.host.nativeElement.releasePointerCapture(event.pointerId);
    // A cancelled drag has no click coming; a finished one might.
    this.suppressClick = event.type === "pointerup";
  }

  /**
   * Where each tab's slot sits along the strip, in the order they are drawn.
   *
   * The dragged tab is measured back to its slot: what the browser reports for
   * it includes the shift it is being carried by, and the slots are what that
   * shift is measured against.
   */
  private slots(draggedIndex: number): Slot[] {
    const carried = this.dragOffset();
    const tabs = this.host.nativeElement.querySelectorAll<HTMLElement>(".tab");
    return [...tabs].map((tab, index) => {
      const rect = tab.getBoundingClientRect();
      return {
        left: rect.left - (index === draggedIndex ? carried : 0),
        width: rect.width,
      };
    });
  }
}

function centerOf(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  return (rect.left + rect.right) / 2;
}
