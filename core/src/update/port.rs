/// Where "what is the newest published release?" comes from.
///
/// Returns `impl Future` rather than being an `async fn`: `async fn` in a
/// public trait trips the `async_fn_in_trait` lint, and CI runs clippy with
/// `-D warnings`. Callers are generic over this (the way `MqttClientManager`
/// is generic over `MqttPort`), so dyn-compatibility isn't needed either way.
pub trait ReleaseSource: Send + Sync {
    fn latest_release(
        &self,
    ) -> impl std::future::Future<Output = Result<ReleaseInfo, UpdateError>> + Send;
}

/// What the source reported, before anything has been decided about it.
///
/// Never crosses IPC - `models::UpdateCheck` is what the frontend sees. Note
/// there is deliberately no URL field: the link the user is about to open in
/// their real browser is built from the parsed tag, not taken from a network
/// response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReleaseInfo {
    pub tag_name: String,
    pub name: Option<String>,
    pub body: Option<String>,
    pub published_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum UpdateError {
    #[error("could not reach GitHub: {0}")]
    Network(String),
    #[error("GitHub returned an unexpected response: {0}")]
    Response(String),
    #[error("too many update checks from this network; try again in an hour")]
    RateLimited,
    // `String` rather than `#[from] StorageError`, which wraps
    // `rusqlite::Error` and is therefore neither `Clone` nor `PartialEq` -
    // same reason `MqttError` has an `Other(String)`.
    #[error("storage error: {0}")]
    Storage(String),
    #[error("this build reports an unusable version ({0})")]
    UnknownCurrentVersion(String),
}

impl From<crate::storage::StorageError> for UpdateError {
    fn from(err: crate::storage::StorageError) -> Self {
        UpdateError::Storage(err.to_string())
    }
}
