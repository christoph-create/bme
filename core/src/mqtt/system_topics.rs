/// The topic space brokers use to publish their own health.
///
/// Wildcards are spelled out rather than left to the caller's `#`, because
/// MQTT forbids a wildcard from matching a leading `$` (MQTT 3.1.1 s4.7.2):
/// a client subscribed to `#` never receives a single `$SYS` message. Reading
/// them is always a deliberate, separate subscription - which is exactly what
/// makes it safe for the app to treat `$SYS` traffic as its own rather than
/// as the user's.
///
/// Mirrored by `SYSTEM_TOPIC_FILTER` in `src/app/core/mqtt/system-topics.ts`.
/// The filter lives here so the frontend cannot subscribe to something
/// arbitrary through the door that skips persistence.
pub const SYSTEM_TOPIC_FILTER: &str = "$SYS/#";

const SYSTEM_TOPIC_PREFIX: &str = "$SYS/";

/// Whether a topic belongs to the broker rather than to the user.
///
/// The separator is part of the test: a bare `$SYS` carries nothing, and
/// `$SYSTEM/load` is somebody's ordinary topic that happens to start with the
/// same letters.
pub fn is_system_topic(topic: &str) -> bool {
    topic.starts_with(SYSTEM_TOPIC_PREFIX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_filter_subscribes_under_the_prefix_it_recognises() {
        assert!(SYSTEM_TOPIC_FILTER.starts_with(SYSTEM_TOPIC_PREFIX));
    }

    #[test]
    fn the_brokers_own_tree_is_recognised() {
        assert!(is_system_topic("$SYS/broker/uptime"));
        assert!(is_system_topic("$SYS/broker/clients/connected"));
    }

    #[test]
    fn the_users_topics_are_left_alone() {
        assert!(!is_system_topic("home/livingroom/climate"));
        assert!(!is_system_topic("sensors/$SYS/temp"));
        assert!(!is_system_topic(""));
    }

    /// The letters alone are not enough: a bare `$SYS` carries nothing, and
    /// `$SYSTEM` is an ordinary topic.
    #[test]
    fn the_separator_is_part_of_the_test() {
        assert!(!is_system_topic("$SYS"));
        assert!(!is_system_topic("$SYSTEM/load"));
    }
}
