//! Why a connection attempt failed, phrased for the connection banner.
//!
//! The counterpart to `oversize`: same job of classifying a
//! `ConnectionError`, but for the failures that happen *before* a session is
//! ever established. Those used to reach the UI as a bare "Disconnected from
//! broker" with nothing attached, which was survivable when the only knobs
//! were host and port and became useless once a connection could also fail on
//! a certificate, a WebSocket path or an ALPN protocol.

use std::io::ErrorKind;

use rumqttc::v5;
use rumqttc::v5::mqttbytes::v5 as v5_packets;
use rumqttc::ConnectionError;

/// A user-facing reason for `err`, or `None` to leave it with its existing
/// treatment - a plain disconnect with no explanation, which is still the right
/// answer for the ordinary "the broker went away" case.
pub fn connect_failure_reason(err: &ConnectionError) -> Option<String> {
    match err {
        ConnectionError::Tls(inner) => Some(tls_reason(inner)),

        // The broker answered, and said no. Its own reason is far better than
        // anything that could be inferred from the socket dying.
        ConnectionError::ConnectionRefused(code) => Some(format!(
            "The broker refused the connection: {}.",
            refusal_reason(*code),
        )),

        ConnectionError::Io(inner) => Some(io_reason(inner)),

        // A server that speaks HTTP but not MQTT-over-WebSocket answers the
        // handshake without the "mqtt" subprotocol. That is what pointing
        // ws:// at a plain web listener - or at the right port with the wrong
        // path - looks like, and it is the most likely WebSocket mistake.
        ConnectionError::ResponseValidation(inner) => Some(websocket_validation_reason(inner)),
        ConnectionError::Websocket(inner) => Some(format!("WebSocket connection failed: {inner}.")),
        ConnectionError::InvalidUrl(inner) => Some(invalid_url_reason(inner)),

        // Everything else - state errors, timeouts on an established session,
        // the eventloop shutting down - keeps its existing silent treatment.
        _ => None,
    }
}

/// The MQTT 5 twin of `connect_failure_reason`. The transport-level arms are
/// the same errors under a different enum; what v5 adds is a broker that
/// *says why*: a CONNACK reason code from a much longer list, and a
/// server-initiated DISCONNECT carrying a code and often a human-readable
/// reason string - which is exactly the text worth putting on the banner.
pub fn connect_failure_reason_v5(err: &v5::ConnectionError) -> Option<String> {
    match err {
        v5::ConnectionError::Tls(inner) => Some(tls_reason(inner)),
        v5::ConnectionError::ConnectionRefused(code) => Some(format!(
            "The broker refused the connection: {}.",
            refusal_reason_v5(*code),
        )),
        v5::ConnectionError::MqttState(v5::StateError::ServerDisconnect {
            reason_code,
            reason_string,
        }) => Some(match reason_string {
            Some(text) if !text.trim().is_empty() => {
                format!("The broker closed the connection: {}.", text.trim())
            }
            _ => format!(
                "The broker closed the connection: {}.",
                disconnect_reason_v5(*reason_code)
            ),
        }),
        v5::ConnectionError::Io(inner) => Some(io_reason(inner)),
        v5::ConnectionError::ResponseValidation(inner) => Some(websocket_validation_reason(inner)),
        v5::ConnectionError::Websocket(inner) => {
            Some(format!("WebSocket connection failed: {inner}."))
        }
        v5::ConnectionError::InvalidUrl(inner) => Some(invalid_url_reason(inner)),
        _ => None,
    }
}

fn tls_reason(inner: &rumqttc::TlsError) -> String {
    format!(
        "TLS handshake failed: {inner}. Check the CA certificate, or the client \
         certificate and key if the broker requires one.",
    )
}

fn io_reason(inner: &std::io::Error) -> String {
    match inner.kind() {
        ErrorKind::ConnectionRefused => {
            "Nothing is listening on that host and port. Check the address, and that the \
             broker is running."
                .to_string()
        }
        ErrorKind::TimedOut => {
            "Timed out reaching the broker. Check the address, and whether a firewall or \
             VPN is in the way."
                .to_string()
        }
        // DNS failures surface as Other/Uncategorized depending on the
        // platform, so they are matched on the message rather than the
        // kind - the alternative is losing the single most common typo.
        _ if looks_like_dns_failure(inner) => format!("Could not resolve the host: {inner}."),
        _ => format!("Network error: {inner}."),
    }
}

fn websocket_validation_reason(inner: &impl std::fmt::Display) -> String {
    format!(
        "The server did not accept an MQTT WebSocket connection ({inner}). Check the port \
         and the path.",
    )
}

fn invalid_url_reason(inner: &impl std::fmt::Display) -> String {
    format!("The broker address is not a valid URL: {inner}.")
}

fn refusal_reason(code: rumqttc::ConnectReturnCode) -> &'static str {
    use rumqttc::ConnectReturnCode::*;
    match code {
        Success => "accepted",
        RefusedProtocolVersion => "it does not support MQTT 3.1.1",
        BadClientId => "the client ID was rejected",
        ServiceUnavailable => "the service is unavailable",
        BadUserNamePassword => "the username or password is wrong",
        NotAuthorized => "not authorized",
    }
}

/// Every v5 CONNACK reason code, phrased to follow "The broker refused the
/// connection: …". A broker that only speaks 3.1.1 answers a v5 CONNECT with
/// `UnsupportedProtocolVersion`, so that one doubles as the hint to switch
/// the connection's protocol back.
fn refusal_reason_v5(code: v5_packets::ConnectReturnCode) -> &'static str {
    use v5_packets::ConnectReturnCode::*;
    match code {
        Success => "accepted",
        RefusedProtocolVersion | UnsupportedProtocolVersion => {
            "it does not support MQTT 5 - try MQTT 3.1.1 for this connection"
        }
        BadClientId | ClientIdentifierNotValid => "the client ID was rejected",
        ServiceUnavailable | ServerUnavailable => "the service is unavailable",
        UnspecifiedError => "it gave no reason",
        MalformedPacket => "it considered the CONNECT packet malformed",
        ProtocolError => "it reported a protocol error",
        ImplementationSpecificError => "of an implementation-specific error",
        BadUserNamePassword => "the username or password is wrong",
        NotAuthorized => "not authorized",
        ServerBusy => "the server is busy",
        Banned => "this client is banned",
        BadAuthenticationMethod => "it does not accept the authentication method",
        TopicNameInvalid => "a topic name is invalid",
        PacketTooLarge => "the CONNECT packet is too large",
        QuotaExceeded => "a quota has been exceeded",
        PayloadFormatInvalid => "the payload format is invalid",
        RetainNotSupported => "it does not support retained messages",
        QoSNotSupported => "it does not support the requested QoS",
        UseAnotherServer => "it wants this client to use another server",
        ServerMoved => "the server has moved",
        ConnectionRateExceeded => "the connection rate limit was exceeded",
    }
}

/// The fallback for a server DISCONNECT that carried a code but no reason
/// string. Phrased to follow "The broker closed the connection: …".
fn disconnect_reason_v5(code: v5_packets::DisconnectReasonCode) -> &'static str {
    use v5_packets::DisconnectReasonCode::*;
    match code {
        NormalDisconnection | DisconnectWithWillMessage => "normal disconnection",
        UnspecifiedError => "it gave no reason",
        MalformedPacket => "it received a malformed packet",
        ProtocolError => "it reported a protocol error",
        ImplementationSpecificError => "of an implementation-specific error",
        NotAuthorized => "not authorized",
        ServerBusy => "the server is busy",
        ServerShuttingDown => "the server is shutting down",
        KeepAliveTimeout => "the keep-alive timed out",
        SessionTakenOver => "another client connected with the same client ID",
        TopicFilterInvalid => "a topic filter is invalid",
        TopicNameInvalid => "a topic name is invalid",
        ReceiveMaximumExceeded => "the receive maximum was exceeded",
        TopicAliasInvalid => "a topic alias is invalid",
        PacketTooLarge => "a packet was too large",
        MessageRateTooHigh => "the message rate is too high",
        QuotaExceeded => "a quota has been exceeded",
        AdministrativeAction => "of an administrative action",
        PayloadFormatInvalid => "a payload format is invalid",
        RetainNotSupported => "it does not support retained messages",
        QoSNotSupported => "it does not support the requested QoS",
        UseAnotherServer => "it wants this client to use another server",
        ServerMoved => "the server has moved",
        SharedSubscriptionNotSupported => "it does not support shared subscriptions",
        ConnectionRateExceeded => "the connection rate limit was exceeded",
        MaximumConnectTime => "the maximum connection time was reached",
        SubscriptionIdentifiersNotSupported => "it does not support subscription identifiers",
        WildcardSubscriptionsNotSupported => "it does not support wildcard subscriptions",
    }
}

fn looks_like_dns_failure(err: &std::io::Error) -> bool {
    let message = err.to_string().to_ascii_lowercase();
    message.contains("name or service not known")
        || message.contains("nodename nor servname")
        || message.contains("failed to lookup address")
        || message.contains("no such host")
}

#[cfg(test)]
mod tests {
    use super::*;
    use rumqttc::ConnectReturnCode;

    #[test]
    fn a_refusal_carries_the_brokers_own_reason() {
        let reason = connect_failure_reason(&ConnectionError::ConnectionRefused(
            ConnectReturnCode::BadUserNamePassword,
        ))
        .expect("a refusal to be explained");

        assert!(reason.contains("username or password"), "{reason}");
    }

    #[test]
    fn a_closed_port_says_so_rather_than_naming_an_errno() {
        let err = ConnectionError::Io(std::io::Error::new(
            ErrorKind::ConnectionRefused,
            "connection refused",
        ));

        let reason = connect_failure_reason(&err).expect("a closed port to be explained");

        assert!(reason.contains("Nothing is listening"), "{reason}");
    }

    #[test]
    fn an_unresolvable_host_is_reported_as_a_lookup_failure() {
        let err = ConnectionError::Io(std::io::Error::other(
            "failed to lookup address information: Name or service not known",
        ));

        let reason = connect_failure_reason(&err).expect("a DNS failure to be explained");

        assert!(reason.contains("resolve the host"), "{reason}");
    }

    /// An ordinary mid-session drop keeps the plain "Disconnected" it has
    /// always had; inventing an explanation for it would be worse than none.
    #[test]
    fn an_unremarkable_failure_gets_no_reason() {
        assert_eq!(
            connect_failure_reason(&ConnectionError::NetworkTimeout),
            None
        );
        assert_eq!(connect_failure_reason(&ConnectionError::RequestsDone), None);
    }

    /// The v3.1.1-only broker is the most likely v5 refusal, and the fix is
    /// on our side of the connection, so the text has to say so.
    #[test]
    fn a_v5_refusal_over_the_protocol_version_points_at_the_setting() {
        let reason = connect_failure_reason_v5(&v5::ConnectionError::ConnectionRefused(
            v5_packets::ConnectReturnCode::UnsupportedProtocolVersion,
        ))
        .expect("a refusal to be explained");

        assert!(reason.contains("MQTT 3.1.1"), "{reason}");
    }

    #[test]
    fn a_v5_only_refusal_code_is_explained_too() {
        let reason = connect_failure_reason_v5(&v5::ConnectionError::ConnectionRefused(
            v5_packets::ConnectReturnCode::Banned,
        ))
        .expect("a refusal to be explained");

        assert!(reason.contains("banned"), "{reason}");
    }

    /// The reason string is the broker's own words - EMQX and Mosquitto both
    /// send one - so it wins over anything derived from the code.
    #[test]
    fn a_server_disconnect_quotes_the_brokers_reason_string() {
        let err = v5::ConnectionError::MqttState(v5::StateError::ServerDisconnect {
            reason_code: v5_packets::DisconnectReasonCode::AdministrativeAction,
            reason_string: Some("kicked by operator".to_string()),
        });

        let reason = connect_failure_reason_v5(&err).expect("a disconnect to be explained");

        assert_eq!(
            reason,
            "The broker closed the connection: kicked by operator."
        );
    }

    #[test]
    fn a_server_disconnect_without_a_reason_string_falls_back_to_the_code() {
        let err = v5::ConnectionError::MqttState(v5::StateError::ServerDisconnect {
            reason_code: v5_packets::DisconnectReasonCode::SessionTakenOver,
            reason_string: None,
        });

        let reason = connect_failure_reason_v5(&err).expect("a disconnect to be explained");

        assert!(reason.contains("same client ID"), "{reason}");
    }

    #[test]
    fn a_v5_closed_port_says_so_like_the_v311_one() {
        let err = v5::ConnectionError::Io(std::io::Error::new(
            ErrorKind::ConnectionRefused,
            "connection refused",
        ));

        let reason = connect_failure_reason_v5(&err).expect("a closed port to be explained");

        assert!(reason.contains("Nothing is listening"), "{reason}");
    }

    #[test]
    fn an_unremarkable_v5_failure_gets_no_reason() {
        assert_eq!(
            connect_failure_reason_v5(&v5::ConnectionError::RequestsDone),
            None
        );
        assert_eq!(
            connect_failure_reason_v5(&v5::ConnectionError::MqttState(
                v5::StateError::AwaitPingResp
            )),
            None
        );
    }
}
