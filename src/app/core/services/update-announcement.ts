import { AvailableRelease, UpdateCheck } from "../models/update-check.model";

export type UpdateAnnouncement =
  | { kind: "update"; release: AvailableRelease }
  | { kind: "up-to-date" }
  | { kind: "silent" };

/**
 * Turns a check result into what the user should actually see.
 *
 * `manual` is whether they asked. A manual check is allowed to be boring
 * ("you're on the latest version") and to re-offer a version they previously
 * skipped, because pressing the button *is* asking again. The automatic check
 * gets exactly one reason to interrupt: a newer version they haven't skipped.
 *
 * Single-sourced here because both callers need the same answer, and the whole
 * "don't be annoying" requirement lives in these four lines.
 */
export function announcementFor(
  result: UpdateCheck,
  manual: boolean,
): UpdateAnnouncement {
  if (result.throttled) return { kind: "silent" };

  const release = result.latest;
  if (!release || !release.is_newer) {
    return manual ? { kind: "up-to-date" } : { kind: "silent" };
  }

  if (release.is_skipped && !manual) return { kind: "silent" };

  return { kind: "update", release };
}
