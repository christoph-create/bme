use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use uuid::Uuid;

/// The set of live connections, one entry per connection id.
///
/// Entries are tagged with a generation so a task that is shutting down can
/// only remove *its own* entry. Without that, a connection replaced while its
/// predecessor was still winding down would be un-registered by the corpse of
/// the task it replaced: still running, but unreachable to every command.
///
/// Generic over the value so the tests below can use a plain integer - the
/// bookkeeping is what is worth testing, and it has nothing to do with MQTT.
pub struct ConnectionRegistry<T> {
    inner: Arc<Mutex<State<T>>>,
}

struct State<T> {
    entries: HashMap<Uuid, Entry<T>>,
    next_generation: u64,
}

struct Entry<T> {
    generation: u64,
    value: T,
}

// Derived, this would demand `T: Clone`; cloning the registry only clones the
// handle to it.
impl<T> Clone for ConnectionRegistry<T> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

impl<T> Default for ConnectionRegistry<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T> ConnectionRegistry<T> {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(State {
                entries: HashMap::new(),
                next_generation: 1,
            })),
        }
    }

    /// Registers `value` as the current entry for `id`, replacing any previous
    /// one, and returns the generation the caller must quote to remove it.
    pub fn insert(&self, id: Uuid, value: T) -> u64 {
        let mut state = self.inner.lock().unwrap();
        let generation = state.next_generation;
        state.next_generation += 1;
        state.entries.insert(id, Entry { generation, value });
        generation
    }

    pub fn contains(&self, id: Uuid) -> bool {
        self.inner.lock().unwrap().entries.contains_key(&id)
    }

    /// Removes the entry whatever its generation - for a caller that wants the
    /// connection gone, not one tidying up after itself.
    pub fn take(&self, id: Uuid) -> Option<T> {
        self.inner
            .lock()
            .unwrap()
            .entries
            .remove(&id)
            .map(|entry| entry.value)
    }

    /// Removes the entry only if it is still the one `generation` registered.
    /// A stale generation is a no-op, not an error: being superseded is a
    /// normal way for a connection task to end.
    pub fn remove_if_current(&self, id: Uuid, generation: u64) {
        let mut state = self.inner.lock().unwrap();
        if state
            .entries
            .get(&id)
            .is_some_and(|entry| entry.generation == generation)
        {
            state.entries.remove(&id);
        }
    }
}

impl<T: Clone> ConnectionRegistry<T> {
    pub fn get(&self, id: Uuid) -> Option<T> {
        self.inner
            .lock()
            .unwrap()
            .entries
            .get(&id)
            .map(|entry| entry.value.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_inserted_entry_is_readable_by_id() {
        let registry = ConnectionRegistry::new();
        let id = Uuid::new_v4();

        registry.insert(id, 7);

        assert!(registry.contains(id));
        assert_eq!(registry.get(id), Some(7));
    }

    #[test]
    fn an_unknown_id_holds_nothing() {
        let registry = ConnectionRegistry::<u32>::new();

        assert!(!registry.contains(Uuid::new_v4()));
        assert_eq!(registry.get(Uuid::new_v4()), None);
    }

    #[test]
    fn each_insert_gets_its_own_generation() {
        let registry = ConnectionRegistry::new();
        let id = Uuid::new_v4();

        let first = registry.insert(id, 1);
        let second = registry.insert(id, 2);

        assert_ne!(first, second);
        assert_eq!(registry.get(id), Some(2));
    }

    #[test]
    fn generations_are_unique_across_connections_too() {
        let registry = ConnectionRegistry::new();

        let first = registry.insert(Uuid::new_v4(), 1);
        let second = registry.insert(Uuid::new_v4(), 2);

        assert_ne!(first, second);
    }

    #[test]
    fn a_task_can_remove_the_entry_it_registered() {
        let registry = ConnectionRegistry::new();
        let id = Uuid::new_v4();
        let generation = registry.insert(id, 1);

        registry.remove_if_current(id, generation);

        assert!(!registry.contains(id));
    }

    /// The bug this whole type exists for: a superseded task winding down must
    /// not unregister the connection that replaced it.
    #[test]
    fn a_superseded_task_cannot_remove_the_entry_that_replaced_it() {
        let registry = ConnectionRegistry::new();
        let id = Uuid::new_v4();
        let stale = registry.insert(id, 1);
        registry.insert(id, 2);

        registry.remove_if_current(id, stale);

        assert_eq!(registry.get(id), Some(2));
    }

    #[test]
    fn removing_an_entry_that_is_already_gone_is_a_no_op() {
        let registry = ConnectionRegistry::<u32>::new();
        let id = Uuid::new_v4();
        let generation = registry.insert(id, 1);
        registry.take(id);

        registry.remove_if_current(id, generation);

        assert!(!registry.contains(id));
    }

    #[test]
    fn take_hands_back_the_value_and_clears_the_entry() {
        let registry = ConnectionRegistry::new();
        let id = Uuid::new_v4();
        registry.insert(id, 5);

        assert_eq!(registry.take(id), Some(5));
        assert_eq!(registry.take(id), None);
        assert!(!registry.contains(id));
    }

    #[test]
    fn clones_share_one_set_of_entries() {
        let registry = ConnectionRegistry::new();
        let clone = registry.clone();
        let id = Uuid::new_v4();

        registry.insert(id, 9);

        assert_eq!(clone.get(id), Some(9));
    }
}
