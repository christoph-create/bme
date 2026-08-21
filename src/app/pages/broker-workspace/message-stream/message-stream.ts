import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from "@angular/core";
import { Subscription } from "rxjs";

import { MessageDraft } from "../../../core/models/message-draft.model";
import { qosNumber } from "../../../core/models/qos";
import { StoredMessage } from "../../../core/models/stored-message.model";
import { JsonFormatService } from "../../../core/services/json-format.service";
import { MessageStoreService } from "../../../core/services/message-store.service";
import { MqttService } from "../../../core/services/mqtt.service";
import { ConfirmDialog } from "../../../shared/confirm-dialog/confirm-dialog";
import { FormattedPayload } from "../../../shared/formatted-payload/formatted-payload";
import { formatMessageBody, formatTruncationNote } from "../format/payload-text";
import { formatTimeAgo } from "../format/time-ago";
import { MeasureHeight } from "./measure-height.directive";
import { messageToDraft } from "./message-to-draft";
import { computeOffsets, computeVisibleRange } from "./virtual-range";

const TICK_INTERVAL_MS = 1000;
const COPIED_FLASH_MS = 1500;

/** Estimated height (px) for a card that hasn't been measured yet - just
 * needs to be in the right ballpark so the initial layout and buffered
 * range aren't wildly off before a real measurement comes in. */
const DEFAULT_ROW_HEIGHT_PX = 90;
/** Vertical spacing between cards - previously the message list's flex
 * `gap`, now folded into the virtual offsets since cards are positioned
 * absolutely instead of relying on normal flex flow. */
const ROW_GAP_PX = 8;
/** Extra rows kept mounted beyond the visible viewport on each side, so
 * scrolling doesn't flash blank space while new rows mount. */
const BUFFER_ITEMS = 6;

/** Pre-formatted view of a message, so expensive work (JSON parsing, text
 * decoding) only re-runs when its inputs actually change, instead of on
 * every change-detection pass - with hundreds of messages in a session,
 * redoing that per template call made fast scrolling visibly janky. */
interface MessageView {
  readonly message: StoredMessage;
  readonly timeAgo: string;
  readonly qos: 0 | 1 | 2;
  readonly body: string;
  /** Set when the message was too large to cross to the UI whole, so the card
   * can say so rather than passing off a quarter of it as the message. */
  readonly truncatedNote: string | null;
  /** Null when the payload isn't editable as text (binary, empty or
   * truncated), which is also what disables the card's Resend control. */
  readonly draft: MessageDraft | null;
}

interface PositionedMessageView {
  readonly view: MessageView;
  readonly top: number;
}

@Component({
  selector: "app-message-stream",
  imports: [MeasureHeight, FormattedPayload, ConfirmDialog],
  templateUrl: "./message-stream.html",
  styleUrl: "./message-stream.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageStream {
  readonly connectionId = input.required<string>();
  readonly topic = input<string | null>(null);
  readonly connected = input<boolean>(true);
  /** False while this workspace is a background tab. The component stays alive
   * either way; hidden it just stops trusting what the DOM reports about its
   * own size, and restores its scroll position when it comes back. */
  readonly active = input(true);
  readonly resendRequested = output<MessageDraft>();

  private readonly messageStore = inject(MessageStoreService);
  private readonly jsonFormat = inject(JsonFormatService);
  private readonly mqttService = inject(MqttService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  readonly messages = signal<readonly StoredMessage[]>([]);
  private readonly now = signal(Date.now());

  readonly prettyJson = signal(true);

  // Pausing freezes what's on screen without unsubscribing - the store keeps
  // accumulating underneath, and resuming shows everything that arrived. The
  // point is to be able to read a message during a flood, so anything that
  // dropped messages instead of buffering them would miss it.
  //
  // A model rather than a plain signal because the charts freeze on the same
  // flag: the workspace owns it and hands it to the tool panel, while this
  // component still needs to clear it when the topic changes.
  readonly paused = model(false);
  readonly pendingCount = signal(0);
  private pendingMessages: readonly StoredMessage[] | null = null;

  /** Transient "Copied" / "Copy failed" note, since a clipboard write has no
   * other visible effect. */
  readonly copiedNote = signal<string | null>(null);
  private copiedTimeout: ReturnType<typeof setTimeout> | null = null;

  readonly confirmingClearRetained = signal(false);
  readonly clearRetainedError = signal<string | null>(null);
  private readonly retainedTopics = signal<ReadonlySet<string>>(new Set());

  /** Whether this topic is *known* to hold a retained message. False also
   * covers "not known either way" - see MessageStoreService.retained$ - so it
   * annotates the Clear retained control rather than gating it. */
  readonly topicHasRetained = computed(() => {
    const topic = this.topic();
    return topic !== null && this.retainedTopics().has(topic);
  });

  readonly pausedLabel = computed(() => {
    const pending = this.pendingCount();
    if (pending === 0) {
      return "Paused";
    }
    return `Paused · ${pending} new`;
  });

  /** Newest first, matching how the panel displays received messages. */
  readonly messageViews = computed<readonly MessageView[]>(() => {
    const now = this.now();
    const topic = this.topic();
    return [...this.messages()].reverse().map((message) => ({
      message,
      timeAgo: formatTimeAgo(now - message.receivedAt),
      qos: qosNumber(message.qos),
      body: formatMessageBody(message.payload, message.payloadLen),
      truncatedNote: formatTruncationNote(
        message.payloadLen,
        message.payload.length,
      ),
      draft:
        topic === null
          ? null
          : messageToDraft(
              topic,
              message,
              (text) => this.jsonFormat.format(text).ok,
            ),
    }));
  });

  readonly messageCountLabel = computed(() => {
    const count = this.messages().length;
    return `${count} ${count === 1 ? "message" : "messages"} in this session`;
  });


  // Virtualization: only the messages currently scrolled into view (plus a
  // small buffer) are rendered as `.message-card` elements. Keeping every
  // card in the DOM at once made panel resizing laggy - the browser had to
  // re-wrap every card's payload text on every resize tick, even the ones
  // scrolled off-screen. Cards are positioned absolutely at a measured (or
  // estimated, until `MeasureHeight` reports back) offset instead of
  // relying on normal flex flow, so only the visible slice needs to exist
  // in the DOM at all.
  private readonly listEl = viewChild<ElementRef<HTMLElement>>("list");
  private readonly rowHeights = new Map<StoredMessage, number>();
  private readonly heightVersion = signal(0);
  private readonly scrollTop = signal(0);
  private readonly viewportHeight = signal(0);

  private readonly rowHeightsList = computed(() => {
    this.heightVersion();
    return this.messageViews().map(
      (v) => this.rowHeights.get(v.message) ?? DEFAULT_ROW_HEIGHT_PX,
    );
  });

  private readonly offsets = computed(() =>
    computeOffsets(this.rowHeightsList(), ROW_GAP_PX),
  );

  readonly totalHeight = computed(() => {
    const offsets = this.offsets();
    return offsets[offsets.length - 1] ?? 0;
  });

  readonly visibleViews = computed<readonly PositionedMessageView[]>(() => {
    const offsets = this.offsets();
    const { startIndex, endIndex } = computeVisibleRange(
      offsets,
      this.scrollTop(),
      this.viewportHeight(),
      BUFFER_ITEMS,
    );
    const views = this.messageViews();
    const positioned: PositionedMessageView[] = [];
    for (let i = startIndex; i < endIndex; i++) {
      positioned.push({ view: views[i], top: offsets[i] });
    }
    return positioned;
  });

  private topicSubscription: Subscription | null = null;
  private retainedSubscription: Subscription | null = null;
  private containerObserver: ResizeObserver | null = null;

  constructor() {
    effect(() => {
      const connectionId = this.connectionId();
      const topic = this.topic();
      untracked(() => this.subscribeTo(connectionId, topic));
    });

    // Keyed on the connection alone: which topics hold a retained message is
    // a property of the broker, not of whichever topic is selected.
    effect(() => {
      const connectionId = this.connectionId();
      untracked(() => {
        this.retainedSubscription?.unsubscribe();
        this.retainedSubscription = this.messageStore
          .retainedTopicsFor(connectionId)
          .subscribe((topics) => this.retainedTopics.set(topics));
      });
    });

    effect(() => {
      const el = this.listEl()?.nativeElement;
      if (
        el &&
        this.containerObserver === null &&
        typeof ResizeObserver !== "undefined"
      ) {
        this.containerObserver = new ResizeObserver(([entry]) => {
          // A `display: none` tab reports zero, which is not a resize - taking
          // it would collapse the virtualized range and lose the scroll
          // position the user left behind on that tab.
          if (entry && entry.contentRect.height > 0) {
            this.viewportHeight.set(entry.contentRect.height);
          }
        });
        this.containerObserver.observe(el);
      }
    });

    // Hiding an element zeroes its scrollTop, so the position has to be put
    // back by hand when the tab is shown again - and only once the element is
    // on screen, because a `display: none` element has no scroll box and drops
    // the assignment silently.
    effect(() => {
      if (!this.active()) {
        return;
      }
      const restoreTo = untracked(() => this.scrollTop());
      afterNextRender(
        () => {
          const el = this.listEl()?.nativeElement;
          if (el) {
            el.scrollTop = restoreTo;
          }
        },
        { injector: this.injector },
      );
    });

    const tickHandle = setInterval(
      () => this.now.set(Date.now()),
      TICK_INTERVAL_MS,
    );
    this.destroyRef.onDestroy(() => {
      clearInterval(tickHandle);
      this.topicSubscription?.unsubscribe();
      this.retainedSubscription?.unsubscribe();
      this.containerObserver?.disconnect();
      if (this.copiedTimeout !== null) {
        clearTimeout(this.copiedTimeout);
      }
    });
  }

  togglePrettyJson(): void {
    this.prettyJson.update((pretty) => !pretty);
  }

  askClearRetained(): void {
    if (this.topic() === null || !this.connected()) {
      return;
    }
    this.clearRetainedError.set(null);
    this.confirmingClearRetained.set(true);
  }

  cancelClearRetained(): void {
    this.confirmingClearRetained.set(false);
  }

  /** Clears a retained message the MQTT way: a zero-length publish to the
   * same topic with the retain flag set. Broker-visible and permanent for
   * every client, hence the confirmation. */
  async clearRetained(): Promise<void> {
    const topic = this.topic();
    this.confirmingClearRetained.set(false);
    if (topic === null) {
      return;
    }

    try {
      await this.mqttService.publish(
        this.connectionId(),
        topic,
        new Uint8Array(0),
        "AtMostOnce",
        true,
      );
    } catch (err) {
      this.clearRetainedError.set(
        err instanceof Error ? err.message : String(err),
      );
      return;
    }
    this.clearRetainedError.set(null);
    // The zero-length publish comes back as ordinary traffic with the retain
    // flag clear, so nothing would otherwise retract the mark.
    this.messageStore.forgetRetained(this.connectionId(), topic);
  }

  resend(draft: MessageDraft | null): void {
    if (draft === null) {
      return;
    }
    this.resendRequested.emit(draft);
  }

  async copyPayload(view: MessageView): Promise<void> {
    // The draft's payload is the real decoded text; `body` is the display
    // string, which for binary/empty payloads is a label, not the payload.
    const text = view.draft?.payload ?? view.body;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      this.flashCopied("Copy failed");
      return;
    }
    this.flashCopied("Copied");
  }

  togglePause(): void {
    if (this.paused()) {
      this.paused.set(false);
      if (this.pendingMessages !== null) {
        this.messages.set(this.pendingMessages);
      }
      this.clearPending();
      return;
    }
    this.paused.set(true);
  }

  /** Drops this topic's history from the store, which also takes its row out
   * of the topic tree - the tree is built from the same history. */
  clearMessages(): void {
    const topic = this.topic();
    if (topic === null) {
      return;
    }
    this.messageStore.clearTopic(this.connectionId(), topic);
    // Emptying the panel explicitly rather than relying on the store's
    // emission: while paused that emission is buffered like any other, so the
    // cleared list would only show up on resume.
    this.messages.set([]);
    this.clearPending();
    this.rowHeights.clear();
    this.heightVersion.update((v) => v + 1);
    this.resetScroll();
  }

  onScroll(event: Event): void {
    // Hiding this tab zeroes the element's scrollTop and fires a scroll event
    // for it. Recording that would wipe the position the effect above exists
    // to put back.
    if (!this.active()) {
      return;
    }
    this.scrollTop.set((event.target as HTMLElement).scrollTop);
  }

  onCardHeight(message: StoredMessage, height: number): void {
    if (this.rowHeights.get(message) === height) {
      return;
    }
    this.rowHeights.set(message, height);
    this.heightVersion.update((v) => v + 1);
  }

  private subscribeTo(connectionId: string, topic: string | null): void {
    this.topicSubscription?.unsubscribe();
    this.rowHeights.clear();
    this.heightVersion.update((v) => v + 1);
    this.resetScroll();
    // A pause belongs to the topic it was applied to - carrying it over would
    // silently freeze a topic the user just opened.
    this.paused.set(false);
    this.clearPending();
    if (topic === null) {
      this.messages.set([]);
      return;
    }
    this.topicSubscription = this.messageStore
      .messagesFor(connectionId, topic)
      .subscribe((messages) => {
        if (this.paused()) {
          // Counting emissions rather than diffing lengths keeps the count
          // honest once the store's per-topic cap starts dropping the oldest.
          this.pendingMessages = messages;
          this.pendingCount.update((n) => n + 1);
          return;
        }
        this.messages.set(messages);
      });
  }

  private clearPending(): void {
    this.pendingMessages = null;
    this.pendingCount.set(0);
  }

  private flashCopied(note: string): void {
    if (this.copiedTimeout !== null) {
      clearTimeout(this.copiedTimeout);
    }
    this.copiedNote.set(note);
    this.copiedTimeout = setTimeout(() => {
      this.copiedNote.set(null);
      this.copiedTimeout = null;
    }, COPIED_FLASH_MS);
  }

  /** New topic, new message history - the previous scroll position has no
   * meaning here, and leaving it as-is could otherwise land the virtualized
   * range past the end of the new (possibly much shorter) content. */
  private resetScroll(): void {
    this.scrollTop.set(0);
    const el = this.listEl()?.nativeElement;
    if (el) {
      el.scrollTop = 0;
    }
  }
}
