//! Telling the user a newer bme has been released.
//!
//! Notify-only: this module finds out whether a newer version exists and
//! remembers enough not to nag about it. It never downloads or installs
//! anything - the user goes to the release page and decides.

pub mod checker;
pub mod github;
pub mod port;
pub mod version;

/// The version the user pressed "Skip this version" on, stored normalised
/// (`"0.8.0"`, never `"v0.8.0"`). Absent means nothing is skipped.
pub const SKIPPED_VERSION_KEY: &str = "update.skipped_version";

/// When GitHub last answered, RFC 3339 in UTC. Written only when a check
/// actually got a response, so a week offline doesn't burn the daily budget.
///
/// The format is stated here rather than left to rusqlite's chrono support
/// because `app_settings.value` is a generic TEXT column - anything reading
/// this key needs the format to be a contract, not a side effect.
pub const LAST_CHECKED_AT_KEY: &str = "update.last_checked_at";
