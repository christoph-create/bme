use std::time::Duration;

use rumqttc::{ConnectionError, StateError};

use crate::mqtt::reconnect::{BASE_DELAY, MAX_DELAY};

/// Ceiling on a single MQTT packet, in either direction.
///
/// rumqttc defaults this to 10 KiB, and a packet over the limit is a framing
/// error that costs the socket - which turned any ordinary 11 KB message into a
/// dropped session. MQTT 3.1.1's own ceiling is 256 MiB; 16 MiB covers every
/// payload a desktop client plausibly wants to look at while still bounding what
/// one misbehaving broker can make a connection allocate. rumqttc's read buffer
/// starts small and grows on demand, so the headroom costs nothing until a large
/// packet actually arrives.
pub const MAX_PACKET_BYTES: usize = 16 * 1024 * 1024;

/// Doubling past this many retries would overflow the shift, and the delay is
/// clamped long before that anyway.
const MAX_EXPONENT: u32 = 20;

/// Why a poll error was the packet's fault rather than the network's, phrased
/// for the connection banner. `None` for every other error, which keeps its
/// existing treatment.
///
/// Only the `MqttState` shapes are matched. The same limit is also enforced
/// while reading the CONNACK, where rumqttc flattens it into an opaque
/// `ConnectionError::Io`; matching that would mean string-sniffing an io error,
/// and a CONNACK over 16 MiB is not a thing that happens.
pub fn oversize_reason(err: &ConnectionError) -> Option<String> {
    match err {
        // The number rumqttc reports is the MQTT *remaining length* - topic,
        // packet id and payload together - not the payload on its own, which is
        // why the log for an 11 KB message read "11661".
        ConnectionError::MqttState(StateError::Deserialization(
            rumqttc::mqttbytes::Error::PayloadSizeLimitExceeded(remaining_len),
        )) => Some(format!(
            "A {} message was dropped: it is larger than the {} packet limit. \
             The connection re-establishes itself, but a retained message this \
             large will keep interrupting it until it is cleared on the broker.",
            human_bytes(*remaining_len),
            human_bytes(MAX_PACKET_BYTES),
        )),
        ConnectionError::MqttState(StateError::OutgoingPacketTooLarge { pkt_size, max }) => {
            Some(format!(
                "A {} packet could not be sent: it is larger than the {} packet limit.",
                human_bytes(*pkt_size),
                human_bytes(*max),
            ))
        }
        _ => None,
    }
}

/// How long to wait before re-establishing a session an oversize packet just
/// cost us. `streak` is 1-based and, unlike `ReconnectPolicy`, there is no
/// budget: a message the broker is holding is not a broken connection, and
/// giving up would take a working broker offline over one payload.
///
/// The cycle is connect -> resubscribe -> broker redelivers -> drop, so without
/// a growing delay a retained oversize message becomes a hot loop. Thirty
/// seconds is slow enough to be harmless and quick enough that everything
/// *else* on the connection still flows.
pub fn oversize_delay(streak: u32) -> Duration {
    let exponent = streak.saturating_sub(1).min(MAX_EXPONENT);
    (BASE_DELAY * (1u32 << exponent)).min(MAX_DELAY)
}

fn human_bytes(bytes: usize) -> String {
    const KB: usize = 1024;
    const MB: usize = 1024 * KB;
    match bytes {
        b if b >= MB => format!("{:.1} MB", b as f64 / MB as f64),
        b if b >= KB => format!("{:.1} KB", b as f64 / KB as f64),
        1 => "1 byte".to_string(),
        b => format!("{b} bytes"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_incoming_packet_over_the_limit_is_reported_with_its_size() {
        let err = ConnectionError::MqttState(StateError::Deserialization(
            rumqttc::mqttbytes::Error::PayloadSizeLimitExceeded(11661),
        ));

        let reason = oversize_reason(&err).expect("classified as oversize");

        assert!(reason.contains("11.4 KB"), "{reason}");
        assert!(reason.contains("16.0 MB"), "{reason}");
    }

    #[test]
    fn an_outgoing_packet_over_the_limit_is_reported_too() {
        let err = ConnectionError::MqttState(StateError::OutgoingPacketTooLarge {
            pkt_size: 20_000,
            max: 10_240,
        });

        let reason = oversize_reason(&err).expect("classified as oversize");

        assert!(reason.contains("19.5 KB"), "{reason}");
    }

    #[test]
    fn an_ordinary_network_error_is_not_a_size_problem() {
        assert_eq!(oversize_reason(&ConnectionError::NetworkTimeout), None);
    }

    /// The match has to discriminate *within* `MqttState`, not just spot it.
    #[test]
    fn another_state_error_is_not_a_size_problem() {
        let err = ConnectionError::MqttState(StateError::WrongPacket);

        assert_eq!(oversize_reason(&err), None);
    }

    #[test]
    fn the_retry_delay_doubles_from_one_second_and_is_capped_at_thirty() {
        let schedule: Vec<u64> = (1..=8).map(|n| oversize_delay(n).as_secs()).collect();

        assert_eq!(schedule, vec![1, 2, 4, 8, 16, 30, 30, 30]);
    }

    /// Unlike the reconnect policy there is no budget, so even an absurd streak
    /// has to keep returning a delay rather than overflowing or giving up.
    #[test]
    fn a_huge_streak_stays_at_the_cap() {
        assert_eq!(oversize_delay(u32::MAX).as_secs(), 30);
        assert_eq!(oversize_delay(0).as_secs(), 1);
    }
}
