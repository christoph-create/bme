/**
 * How long to wait before calling a broker's silence an answer.
 *
 * Mosquitto's `sys_interval` defaults to **10 seconds**, so anything shorter
 * would declare a perfectly healthy broker unsupported for the first few
 * seconds of every session. Fifteen leaves room for one interval plus a slow
 * one.
 */
export const UNSUPPORTED_AFTER_MS = 15_000;

export type SysDashboardState =
  /** Reading `$SYS`, and there is something to show. */
  | "ready"
  /** Not monitoring this broker - the panel offers the switch. */
  | "off"
  /** Monitoring, but there is no session to read over. */
  | "disconnected"
  /** Monitoring a live session, nothing has arrived yet. */
  | "waiting"
  /** Monitoring a live session long enough that silence is the answer. */
  | "unsupported";

export interface SysDashboardInput {
  readonly connected: boolean;
  readonly monitoring: boolean;
  readonly sysTopicCount: number;
  /** Milliseconds since monitoring started on this session. */
  readonly msSinceStart: number;
}

/**
 * Which of the panel's five faces to show.
 *
 * Data wins over everything else, which is what lets `"unsupported"` turn
 * back into `"ready"` when a slow broker finally publishes - and what keeps
 * the last known readings on screen after a disconnect instead of replacing
 * them with an explanation of something the user can already see in the
 * header.
 */
export function sysDashboardState(input: SysDashboardInput): SysDashboardState {
  if (input.sysTopicCount > 0) {
    return "ready";
  }
  if (!input.monitoring) {
    return "off";
  }
  if (!input.connected) {
    return "disconnected";
  }
  return input.msSinceStart >= UNSUPPORTED_AFTER_MS ? "unsupported" : "waiting";
}
