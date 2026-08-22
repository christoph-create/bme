//! Why a connection attempt failed, phrased for the connection banner.
//!
//! The counterpart to `oversize`: same job of classifying a
//! `ConnectionError`, but for the failures that happen *before* a session is
//! ever established. Those used to reach the UI as a bare "Disconnected from
//! broker" with nothing attached, which was survivable when the only knobs
//! were host and port and became useless once a connection could also fail on
//! a certificate, a WebSocket path or an ALPN protocol.

use std::io::ErrorKind;

use rumqttc::ConnectionError;

/// A user-facing reason for `err`, or `None` to leave it with its existing
/// treatment - a plain disconnect with no explanation, which is still the right
/// answer for the ordinary "the broker went away" case.
pub fn connect_failure_reason(err: &ConnectionError) -> Option<String> {
    match err {
        ConnectionError::Tls(inner) => Some(format!(
            "TLS handshake failed: {inner}. Check the CA certificate, or the client \
             certificate and key if the broker requires one.",
        )),

        // The broker answered, and said no. Its own reason is far better than
        // anything that could be inferred from the socket dying.
        ConnectionError::ConnectionRefused(code) => Some(format!(
            "The broker refused the connection: {}.",
            refusal_reason(*code),
        )),

        ConnectionError::Io(inner) => match inner.kind() {
            ErrorKind::ConnectionRefused => Some(
                "Nothing is listening on that host and port. Check the address, and that the \
                 broker is running."
                    .to_string(),
            ),
            ErrorKind::TimedOut => Some(
                "Timed out reaching the broker. Check the address, and whether a firewall or \
                 VPN is in the way."
                    .to_string(),
            ),
            // DNS failures surface as Other/Uncategorized depending on the
            // platform, so they are matched on the message rather than the
            // kind - the alternative is losing the single most common typo.
            _ if looks_like_dns_failure(inner) => {
                Some(format!("Could not resolve the host: {inner}."))
            }
            _ => Some(format!("Network error: {inner}.")),
        },

        // A server that speaks HTTP but not MQTT-over-WebSocket answers the
        // handshake without the "mqtt" subprotocol. That is what pointing
        // ws:// at a plain web listener - or at the right port with the wrong
        // path - looks like, and it is the most likely WebSocket mistake.
        ConnectionError::ResponseValidation(inner) => Some(format!(
            "The server did not accept an MQTT WebSocket connection ({inner}). Check the port \
             and the path.",
        )),
        ConnectionError::Websocket(inner) => Some(format!("WebSocket connection failed: {inner}.")),
        ConnectionError::InvalidUrl(inner) => {
            Some(format!("The broker address is not a valid URL: {inner}."))
        }

        // Everything else - state errors, timeouts on an established session,
        // the eventloop shutting down - keeps its existing silent treatment.
        _ => None,
    }
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
}
