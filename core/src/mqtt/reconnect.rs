use std::time::Duration;

use crate::models::BrokerConnection;

/// Wait before the first retry. Each further attempt doubles it, up to
/// `MAX_DELAY`.
pub const BASE_DELAY: Duration = Duration::from_secs(1);
/// Ceiling on the backoff. Beyond this, doubling stops buying anything and
/// just makes the app look dead to someone watching the banner.
pub const MAX_DELAY: Duration = Duration::from_secs(30);
pub const DEFAULT_MAX_ATTEMPTS: u32 = 10;

/// Doubling past this many attempts would overflow the shift; the delay has
/// long since been clamped to `MAX_DELAY` anyway, so the exponent is capped
/// rather than the arithmetic being made checked.
const MAX_EXPONENT: u32 = 20;

/// Whether - and how persistently - a dropped connection should re-establish
/// itself. Kept free of rumqttc and tokio types so the schedule can be tested
/// without a broker or a clock.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReconnectPolicy {
    pub enabled: bool,
    pub max_attempts: u32,
}

impl ReconnectPolicy {
    pub fn from_broker(broker: &BrokerConnection) -> Self {
        Self {
            enabled: broker.auto_reconnect,
            max_attempts: broker.max_reconnect_attempts,
        }
    }

    pub fn disabled() -> Self {
        Self {
            enabled: false,
            max_attempts: 0,
        }
    }

    /// How long to wait before retry number `attempt` (1-based). `None` means
    /// the budget is spent and the caller should give up and report a plain
    /// disconnect.
    pub fn delay_for(&self, attempt: u32) -> Option<Duration> {
        if !self.enabled || attempt == 0 || attempt > self.max_attempts {
            return None;
        }
        let exponent = (attempt - 1).min(MAX_EXPONENT);
        Some((BASE_DELAY * (1u32 << exponent)).min(MAX_DELAY))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::BrokerScheme;

    fn policy(max_attempts: u32) -> ReconnectPolicy {
        ReconnectPolicy {
            enabled: true,
            max_attempts,
        }
    }

    fn secs(delay: Option<Duration>) -> Option<u64> {
        delay.map(|delay| delay.as_secs())
    }

    #[test]
    fn the_delay_doubles_from_one_second_and_is_capped_at_thirty() {
        let policy = policy(10);

        let schedule: Vec<Option<u64>> = (1..=8).map(|n| secs(policy.delay_for(n))).collect();

        assert_eq!(
            schedule,
            vec![
                Some(1),
                Some(2),
                Some(4),
                Some(8),
                Some(16),
                Some(30),
                Some(30),
                Some(30),
            ]
        );
    }

    #[test]
    fn the_last_allowed_attempt_still_gets_a_delay_and_the_next_one_gives_up() {
        let policy = policy(10);

        assert_eq!(secs(policy.delay_for(10)), Some(30));
        assert_eq!(policy.delay_for(11), None);
    }

    #[test]
    fn a_disabled_policy_never_retries() {
        let policy = ReconnectPolicy {
            enabled: false,
            max_attempts: 10,
        };

        assert_eq!(policy.delay_for(1), None);
    }

    #[test]
    fn zero_max_attempts_never_retries() {
        assert_eq!(policy(0).delay_for(1), None);
    }

    #[test]
    fn a_huge_attempt_count_stays_at_the_cap_instead_of_overflowing() {
        assert_eq!(secs(policy(u32::MAX).delay_for(1000)), Some(30));
        assert_eq!(secs(policy(u32::MAX).delay_for(u32::MAX)), Some(30));
    }

    #[test]
    fn from_broker_reads_the_connections_own_settings() {
        let broker = BrokerConnection {
            id: uuid::Uuid::new_v4(),
            name: "Local".to_string(),
            host: "localhost".to_string(),
            port: 1883,
            client_id: "bme-dev".to_string(),
            username: None,
            password: None,
            scheme: BrokerScheme::Mqtt,
            ws_path: None,
            ca_cert_path: None,
            client_cert_path: None,
            client_key_path: None,
            alpn: None,
            skip_cert_verification: false,
            keep_alive_secs: 30,
            auto_reconnect: true,
            max_reconnect_attempts: 3,
            subscriptions: vec![],
        };

        assert_eq!(
            ReconnectPolicy::from_broker(&broker),
            ReconnectPolicy {
                enabled: true,
                max_attempts: 3,
            }
        );
    }

    #[test]
    fn disabled_is_the_policy_for_throwaway_connections() {
        assert_eq!(ReconnectPolicy::disabled().delay_for(1), None);
    }
}
