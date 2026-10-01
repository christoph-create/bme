import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from "@angular/core";
import { Subscription } from "rxjs";

import { ComparePins } from "../../../../core/models/compare-pin.model";
import { StoredMessage } from "../../../../core/models/stored-message.model";
import { JsonFormatService } from "../../../../core/services/json-format.service";
import { MessageStoreService } from "../../../../core/services/message-store.service";
import { formatClockTime } from "../../format/clock-time";
import { SideText, compareFace, readSide, selectCompareSides } from "./compare-state";
import { JsonDiffTable } from "./json-diff-table";
import { diffJson, groupDiffRows } from "./json-diff";
import { LineDiffView } from "./line-diff-view";
import { diffLines } from "./line-diff";

/** Why a side cannot be diffed, in the words Resend already uses for the same
 * three cases - the two controls have to agree about why. */
const NOT_DIFFABLE_REASONS: Record<
  Extract<SideText, { ok: false }>["reason"],
  string
> = {
  empty: "This message has an empty payload",
  binary: "This payload isn't text",
  truncated: "This message was too large to have arrived whole",
};

/**
 * Compares two messages on the selected topic.
 *
 * Live by default, diffing the newest message against the one before it, with
 * no clicks at all - the question "what just changed?" is the one worth
 * answering for free. Pinning a card in the message stream freezes the
 * baseline and lets the newest message keep landing against it.
 */
@Component({
  selector: "app-payload-compare",
  imports: [JsonDiffTable, LineDiffView],
  templateUrl: "./payload-compare.html",
  styleUrl: "./payload-compare.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PayloadCompare {
  readonly connectionId = input.required<string>();
  readonly selectedTopic = input<string | null>(null);
  /** Splits the field table into path / before / after columns - only worth
   * it once the dock has taken room from the message stream. */
  readonly wide = input(false);
  /** The message stream's Pause, which freezes the live side with it. */
  readonly paused = input(false);
  readonly pins = input<ComparePins | null>(null);

  /** The chip's way back to Live, which the stream's own Unpin cannot always
   * offer: a pinned baseline outlives the card it came from. */
  readonly unpinRequested = output<void>();

  private readonly messageStore = inject(MessageStoreService);
  private readonly jsonFormat = inject(JsonFormatService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly messages = signal<readonly StoredMessage[]>([]);

  /** Captured once rather than ticked: the A/B header shows absolute clock
   * times, and `formatClockTime` only consults `now` for its same-day
   * branch. Two columns reading "18s ago / 12s ago" would be much harder to
   * use than "09:31:02 / 09:31:08", and this needs no timer at all. */
  private readonly now = Date.now();

  /** Decode and JSON-validity, memoized on the message object - the store
   * preserves identity across emissions, the same trick value-chart-card's
   * parse cache uses. It also keeps the diff below from recomputing while
   * both sides are frozen: the memo hands back the same reference, so the
   * computed chain stops there. */
  private readonly sides = new WeakMap<StoredMessage, SideText>();

  readonly selection = computed(() =>
    selectCompareSides({
      selectedTopic: this.selectedTopic(),
      messages: this.messages(),
      pins: this.pins(),
    }),
  );

  readonly beforeSide = computed<SideText | null>(() => {
    const message = this.selection().before;
    return message === null ? null : this.readOnce(message);
  });

  readonly afterSide = computed<SideText | null>(() => {
    const message = this.selection().after;
    return message === null ? null : this.readOnce(message);
  });

  readonly face = computed(() =>
    compareFace({
      selectedTopic: this.selectedTopic(),
      historyEmpty: this.messages().length === 0,
      sameMessage: this.selection().sameMessage,
      before: this.beforeSide(),
      after: this.afterSide(),
    }),
  );

  readonly pinned = computed(() => this.selection().mode === "pinned");

  readonly jsonDiff = computed(() => {
    const before = this.beforeSide();
    const after = this.afterSide();
    if (before === null || after === null || !before.ok || !after.ok) {
      return null;
    }
    return diffJson(parse(before.text), parse(after.text));
  });

  readonly jsonRows = computed(() => {
    const diff = this.jsonDiff();
    return diff === null ? [] : groupDiffRows(diff.rows);
  });

  readonly lineDiff = computed(() => {
    const before = this.beforeSide();
    const after = this.afterSide();
    if (before === null || after === null || !before.ok || !after.ok) {
      return null;
    }
    return diffLines(before.text, after.text);
  });

  /** `~3  +1  -1`, or null when there is nothing to count. */
  readonly summary = computed<string | null>(() => {
    const face = this.face();
    if (face === "json") {
      const diff = this.jsonDiff();
      if (diff === null) {
        return null;
      }
      return `~${diff.changedCount}  +${diff.addedCount}  -${diff.removedCount}`;
    }
    if (face === "lines") {
      const diff = this.lineDiff();
      if (diff === null || diff.tooLarge) {
        return null;
      }
      return `+${diff.addedCount}  -${diff.removedCount}`;
    }
    return null;
  });

  readonly beforeLabel = computed(() => this.timeLabel(this.selection().before));
  readonly afterLabel = computed(() => this.timeLabel(this.selection().after));

  /** What the B column is following. A pin plus a pause is a double freeze,
   * and without saying so the chip would claim the pin is the only reason the
   * column has stopped moving. */
  readonly afterRole = computed(() => {
    if (this.pins()?.b != null && this.pinned()) {
      return "pinned";
    }
    return this.paused() ? "latest (paused)" : "latest";
  });

  /** `togglePin` lets an older message be pinned as B, which renders the diff
   * backwards. Labelling that beats silently reordering the columns. */
  readonly reversed = computed(() => {
    const { before, after } = this.selection();
    return (
      before !== null && after !== null && after.receivedAt < before.receivedAt
    );
  });

  readonly notDiffableReasons = computed(() =>
    [
      { slot: "A", side: this.beforeSide() },
      { slot: "B", side: this.afterSide() },
    ].flatMap(({ slot, side }) =>
      side !== null && !side.ok
        ? [{ slot, reason: NOT_DIFFABLE_REASONS[side.reason] }]
        : [],
    ),
  );

  readonly identicalNote = computed(() => {
    const bytes = this.selection().after?.payloadLen ?? 0;
    return `${bytes} ${bytes === 1 ? "byte" : "bytes"} on both sides.`;
  });

  /** Set when exactly one side is JSON. Swapping renderers without saying so
   * makes a tool feel broken. */
  readonly mixedFormats = computed(() => {
    const before = this.beforeSide();
    const after = this.afterSide();
    return (
      before !== null &&
      after !== null &&
      before.ok &&
      after.ok &&
      before.json !== after.json
    );
  });

  private subscription: Subscription | null = null;
  /** What arrived while paused. Buffered rather than dropped so resuming
   * shows the real history, not a gap - the stream's Pause exists so you can
   * read during a flood. */
  private pending: readonly StoredMessage[] | null = null;

  constructor() {
    effect(() => {
      const connectionId = this.connectionId();
      const topic = this.selectedTopic();
      untracked(() => this.watchSelectedTopic(connectionId, topic));
    });

    effect(() => {
      if (this.paused()) {
        return;
      }
      const pending = this.pending;
      if (pending !== null) {
        this.pending = null;
        untracked(() => this.messages.set(pending));
      }
    });

    this.destroyRef.onDestroy(() => this.subscription?.unsubscribe());
  }

  unpin(): void {
    this.unpinRequested.emit();
  }

  private timeLabel(message: StoredMessage | null): string {
    return message === null
      ? "—"
      : formatClockTime(message.receivedAt, this.now);
  }

  private readOnce(message: StoredMessage): SideText {
    const cached = this.sides.get(message);
    if (cached !== undefined) {
      return cached;
    }
    const side = readSide(
      message,
      (text) => this.jsonFormat.format(text).ok,
    );
    this.sides.set(message, side);
    return side;
  }

  private watchSelectedTopic(connectionId: string, topic: string | null): void {
    this.subscription?.unsubscribe();
    this.pending = null;
    if (topic === null) {
      this.messages.set([]);
      return;
    }
    this.subscription = this.messageStore
      .messagesFor(connectionId, topic)
      .subscribe((messages) => {
        if (this.paused()) {
          this.pending = messages;
          return;
        }
        this.messages.set(messages);
      });
  }
}

/** The text is already known to parse - `readSide` checked it - so the catch
 * is only here to keep the signature honest. */
function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
