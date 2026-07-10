use uuid::Uuid;

/// MQTT quality-of-service level (0, 1, 2 on the wire).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QoS {
    AtMostOnce,
    AtLeastOnce,
    ExactlyOnce,
}

impl TryFrom<i64> for QoS {
    type Error = String;

    fn try_from(value: i64) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(QoS::AtMostOnce),
            1 => Ok(QoS::AtLeastOnce),
            2 => Ok(QoS::ExactlyOnce),
            other => Err(format!("invalid QoS value: {other}")),
        }
    }
}

impl From<QoS> for i64 {
    fn from(qos: QoS) -> Self {
        match qos {
            QoS::AtMostOnce => 0,
            QoS::AtLeastOnce => 1,
            QoS::ExactlyOnce => 2,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Subscription {
    pub id: Uuid,
    pub connection_id: Uuid,
    pub topic: String,
    pub qos: QoS,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrokerConnection {
    pub id: Uuid,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub client_id: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub use_tls: bool,
    pub keep_alive_secs: u16,
    pub subscriptions: Vec<Subscription>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewSubscription {
    pub topic: String,
    pub qos: QoS,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewBrokerConnection {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub client_id: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub use_tls: bool,
    pub keep_alive_secs: u16,
    pub subscriptions: Vec<NewSubscription>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qos_roundtrips_through_i64() {
        for qos in [QoS::AtMostOnce, QoS::AtLeastOnce, QoS::ExactlyOnce] {
            let as_int: i64 = qos.into();
            assert_eq!(QoS::try_from(as_int), Ok(qos));
        }
    }

    #[test]
    fn qos_rejects_invalid_values() {
        assert!(QoS::try_from(3).is_err());
    }
}
