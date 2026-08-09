import { Injectable, Signal, signal } from "@angular/core";

/** One open chart: a topic, and which number within its payloads to plot. */
export interface ChartSpec {
  readonly id: string;
  readonly connectionId: string;
  readonly topic: string;
  /** Empty for a bare numeric payload. */
  readonly fieldPath: readonly string[];
  /** What the card header shows - the dotted field path, or the topic's last
   * segment when the payload is a bare number. */
  readonly label: string;
}

let nextId = 1;

/**
 * Which value charts the user has open, per connection.
 *
 * Session-only, like the message history it draws from - closing the app
 * loses both. It lives here rather than on the tool panel because charts have
 * to survive leaving the workspace and coming back (the history does), and
 * because the message stream's "Chart" link needs to read the same state to
 * show whether a field is already charted.
 *
 * Signals rather than the BehaviorSubjects of MessageStoreService next door:
 * that store is RxJS-shaped because an RxJS event stream feeds it, and chart
 * specs have no such source - only components read and write them.
 */
@Injectable({ providedIn: "root" })
export class ValueChartsService {
  private readonly state = signal<readonly ChartSpec[]>([]);

  /** Every open chart across all connections; callers filter by connection. */
  readonly charts: Signal<readonly ChartSpec[]> = this.state.asReadonly();

  /** No-op if this exact topic and field is already charted, so the "Chart"
   * link can be a plain toggle without first checking. */
  add(spec: Omit<ChartSpec, "id">): void {
    if (this.isCharted(spec.connectionId, spec.topic, spec.fieldPath)) {
      return;
    }
    this.state.update((charts) => [...charts, { ...spec, id: `chart-${nextId++}` }]);
  }

  remove(id: string): void {
    this.state.update((charts) => charts.filter((chart) => chart.id !== id));
  }

  removeAllFor(connectionId: string): void {
    this.state.update((charts) =>
      charts.filter((chart) => chart.connectionId !== connectionId),
    );
  }

  isCharted(
    connectionId: string,
    topic: string,
    fieldPath: readonly string[],
  ): boolean {
    return this.state().some(
      (chart) =>
        chart.connectionId === connectionId &&
        chart.topic === topic &&
        samePath(chart.fieldPath, fieldPath),
    );
  }

  /** The chart on this topic and field, if any - what the stream's "Chart"
   * link needs in order to remove what a second click should undo. */
  find(
    connectionId: string,
    topic: string,
    fieldPath: readonly string[],
  ): ChartSpec | undefined {
    return this.state().find(
      (chart) =>
        chart.connectionId === connectionId &&
        chart.topic === topic &&
        samePath(chart.fieldPath, fieldPath),
    );
  }
}

/** Compared step by step rather than by a joined string, so a key containing
 * a dot can't collide with a two-step path. */
function samePath(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((step, index) => step === b[index]);
}
