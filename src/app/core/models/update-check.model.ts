/**
 * Mirrors `AvailableRelease` in core/src/models.rs. Facts about the newest
 * published release - not a verdict on whether to show anything.
 */
export interface AvailableRelease {
  /** Normalised, without the `v` prefix: "0.8.0". */
  version: string;
  name: string | null;
  /** Markdown, already truncated by the backend. Rendered as plain text. */
  notes: string | null;
  url: string;
  published_at: string | null;
  is_newer: boolean;
  is_skipped: boolean;
}

/** Mirrors `UpdateCheck` in core/src/models.rs. */
export interface UpdateCheck {
  current_version: string;
  /** Null when the daily throttle skipped the call, or nothing is published. */
  latest: AvailableRelease | null;
  throttled: boolean;
}
