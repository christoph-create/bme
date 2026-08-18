import { Injectable, computed, inject, signal } from "@angular/core";

import { BrokerConnection } from "../models/broker-connection.model";
import { nextActiveId } from "../workspaces/next-active-tab";
import { ConnectionsService } from "./connections.service";
import { MessageStoreService } from "./message-store.service";
import { ValueChartsService } from "./value-charts.service";

/**
 * Which broker workspaces are open, in tab order, and which one is showing.
 *
 * Session-only by design: closing a tab leaves nothing behind, and restarting
 * the app opens none.
 */
@Injectable({ providedIn: "root" })
export class WorkspacesService {
  private readonly connectionsService = inject(ConnectionsService);
  private readonly messageStore = inject(MessageStoreService);
  private readonly valueCharts = inject(ValueChartsService);

  private readonly ids = signal<readonly string[]>([]);
  private readonly active = signal<string | null>(null);
  private readonly connections = signal<ReadonlyMap<string, BrokerConnection>>(
    new Map(),
  );

  readonly openIds = this.ids.asReadonly();
  readonly activeId = this.active.asReadonly();
  readonly hasOpenWorkspaces = computed(() => this.ids().length > 0);

  /**
   * The broker record behind a tab, fetched once when it opens.
   *
   * Held here rather than in the workspace component so the tab bar and the
   * workspace header read the same record from the same fetch.
   */
  connectionFor(connectionId: string): BrokerConnection | null {
    return this.connections().get(connectionId) ?? null;
  }

  /** Opens a tab for `connectionId` if it isn't already open, and shows it. */
  open(connectionId: string): void {
    if (!this.ids().includes(connectionId)) {
      this.ids.update((ids) => [...ids, connectionId]);
      void this.loadConnection(connectionId);
    }
    this.active.set(connectionId);
  }

  /** Hides every workspace without closing any - what leaving for another page
   * does, so coming back finds the tabs as they were. */
  deactivate(): void {
    this.active.set(null);
  }

  /**
   * Closes a tab and returns the id to show instead, or null if that was the
   * last one and the caller should go back to the broker list.
   *
   * The session history and charts go with it: nothing about this workspace is
   * persisted, so keeping them would only leak.
   */
  close(connectionId: string): string | null {
    if (!this.ids().includes(connectionId)) {
      return this.active();
    }
    const next = nextActiveId(this.ids(), connectionId, this.active());

    this.ids.update((ids) => ids.filter((id) => id !== connectionId));
    this.connections.update((current) => {
      const remaining = new Map(current);
      remaining.delete(connectionId);
      return remaining;
    });
    this.active.set(next);
    this.messageStore.clear(connectionId);
    this.valueCharts.removeAllFor(connectionId);

    return next;
  }

  private async loadConnection(connectionId: string): Promise<void> {
    let connection: BrokerConnection | null = null;
    try {
      connection = await this.connectionsService.get(connectionId);
    } catch {
      // Non-fatal: the tab and the header fall back to a generic label. Real
      // connection problems surface through ConnectionStatusService.
    }
    if (!connection) return;
    // Guard against a tab closed while the fetch was in flight.
    if (!this.ids().includes(connectionId)) return;
    this.connections.update((current) =>
      new Map(current).set(connectionId, connection),
    );
  }
}
