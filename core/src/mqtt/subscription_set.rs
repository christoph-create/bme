use crate::models::{BrokerConnection, QoS};

/// The topics a connection wants to be subscribed to, as opposed to the ones
/// the broker currently knows about.
///
/// bme connects with a clean session, so every reconnect starts with a broker
/// that has forgotten all of them - the connection task replays this set after
/// each ConnAck. It has to track runtime subscribe/unsubscribe too, not just
/// the list the connection was opened with, or a topic added mid-session would
/// silently stop delivering after the first drop.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct SubscriptionSet {
    entries: Vec<(String, QoS)>,
}

impl SubscriptionSet {
    pub fn from_broker(broker: &BrokerConnection) -> Self {
        Self {
            entries: broker
                .subscriptions
                .iter()
                .map(|subscription| (subscription.topic.clone(), subscription.qos))
                .collect(),
        }
    }

    /// Re-subscribing to a topic at a different QoS replaces the old entry in
    /// place rather than adding a second one - two SUBSCRIBEs for the same
    /// filter is not two subscriptions, and replaying both would just send the
    /// broker a contradiction.
    pub fn insert(&mut self, topic: String, qos: QoS) {
        match self.entries.iter_mut().find(|(known, _)| known == &topic) {
            Some(entry) => entry.1 = qos,
            None => self.entries.push((topic, qos)),
        }
    }

    pub fn remove(&mut self, topic: &str) {
        self.entries.retain(|(known, _)| known != topic);
    }

    pub fn iter(&self) -> impl Iterator<Item = (&str, QoS)> {
        self.entries
            .iter()
            .map(|(topic, qos)| (topic.as_str(), *qos))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Subscription;
    use uuid::Uuid;

    fn broker_with(topics: &[(&str, QoS)]) -> BrokerConnection {
        let id = Uuid::new_v4();
        BrokerConnection {
            id,
            name: "Local".to_string(),
            host: "localhost".to_string(),
            port: 1883,
            client_id: "bme-dev".to_string(),
            username: None,
            password: None,
            use_tls: false,
            keep_alive_secs: 30,
            auto_reconnect: true,
            max_reconnect_attempts: 10,
            subscriptions: topics
                .iter()
                .map(|(topic, qos)| Subscription {
                    id: Uuid::new_v4(),
                    connection_id: id,
                    topic: (*topic).to_string(),
                    qos: *qos,
                })
                .collect(),
        }
    }

    fn entries(set: &SubscriptionSet) -> Vec<(String, QoS)> {
        set.iter()
            .map(|(topic, qos)| (topic.to_string(), qos))
            .collect()
    }

    #[test]
    fn it_seeds_from_the_connections_saved_subscriptions() {
        let broker = broker_with(&[("sensors/#", QoS::AtLeastOnce), ("status", QoS::AtMostOnce)]);

        let set = SubscriptionSet::from_broker(&broker);

        assert_eq!(
            entries(&set),
            vec![
                ("sensors/#".to_string(), QoS::AtLeastOnce),
                ("status".to_string(), QoS::AtMostOnce),
            ]
        );
    }

    #[test]
    fn inserting_a_new_topic_appends_it() {
        let mut set = SubscriptionSet::default();

        set.insert("a".to_string(), QoS::AtMostOnce);
        set.insert("b".to_string(), QoS::ExactlyOnce);

        assert_eq!(
            entries(&set),
            vec![
                ("a".to_string(), QoS::AtMostOnce),
                ("b".to_string(), QoS::ExactlyOnce),
            ]
        );
    }

    #[test]
    fn inserting_a_known_topic_replaces_its_qos_in_place() {
        let mut set = SubscriptionSet::default();
        set.insert("a".to_string(), QoS::AtMostOnce);
        set.insert("b".to_string(), QoS::AtMostOnce);

        set.insert("a".to_string(), QoS::ExactlyOnce);

        assert_eq!(
            entries(&set),
            vec![
                ("a".to_string(), QoS::ExactlyOnce),
                ("b".to_string(), QoS::AtMostOnce),
            ]
        );
    }

    #[test]
    fn removing_drops_only_that_topic() {
        let mut set = SubscriptionSet::from_broker(&broker_with(&[
            ("a", QoS::AtMostOnce),
            ("b", QoS::AtMostOnce),
        ]));

        set.remove("a");

        assert_eq!(entries(&set), vec![("b".to_string(), QoS::AtMostOnce)]);
    }

    #[test]
    fn removing_an_unknown_topic_is_a_no_op() {
        let mut set = SubscriptionSet::from_broker(&broker_with(&[("a", QoS::AtMostOnce)]));

        set.remove("nope");

        assert_eq!(entries(&set), vec![("a".to_string(), QoS::AtMostOnce)]);
    }
}
