const DEMO_EPOCH_MS = Date.UTC(2026, 6, 19, 9, 30, 0);

let elapsedMs = 0;

/**
 * Replaces `Date.now()` with a virtual clock that only moves when
 * {@link advanceDemoClock} is called.
 *
 * Received messages are stamped with `Date.now()` on arrival
 * (`MessageStoreService.append`) and the stream renders them as "12s ago", so
 * without this every screenshot run would produce slightly different text and
 * the PNGs would never compare equal. The alternative - Playwright's clock
 * API - also freezes `setTimeout`/`requestAnimationFrame`, which stalls
 * Angular's change detection and Playwright's own waiting. Overriding only
 * `Date.now` keeps every timer real, so the app behaves exactly as it does in
 * production; the sole difference is which number it reads for "now".
 */
export function installDemoClock(): void {
  Date.now = () => DEMO_EPOCH_MS + elapsedMs;
}

export function advanceDemoClock(ms: number): void {
  elapsedMs += ms;
}
