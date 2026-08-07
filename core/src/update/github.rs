use std::sync::Once;
use std::time::Duration;

use serde::Deserialize;

use crate::update::port::{ReleaseInfo, ReleaseSource, UpdateError};
use crate::update::version::Version;

/// The repository bme is released from. Hard-coded on purpose: this is the
/// one place the app reaches out to, and it should not be configurable by
/// anything a user or a payload can reach.
pub const REPO_OWNER: &str = "christoph-create";
pub const REPO_NAME: &str = "bme";

const LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/christoph-create/bme/releases/latest";

/// Release notes are markdown from the network and get rendered in a small
/// dialog; truncating here keeps the IPC payload bounded rather than trusting
/// whatever someone wrote in a release description.
const MAX_NOTES_CHARS: usize = 4_000;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// Covers the whole request including reading the body, so this is also the
/// ceiling on how long the "Check for updates" button can spin.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// reqwest is built with `rustls-no-provider`, so nothing installs a crypto
/// provider for us (see the rationale in core/Cargo.toml). Doing it here, once,
/// keeps the side effect next to the only code that needs it. `install_default`
/// returns `Err` if something else got there first, which is fine - any
/// installed provider works.
static INSTALL_CRYPTO_PROVIDER: Once = Once::new();

fn ensure_crypto_provider() {
    INSTALL_CRYPTO_PROVIDER.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

/// The public release page for a version. Built from the parsed tag rather
/// than taken from the API response: this URL opens in the user's real
/// browser, so it should not come from the network.
pub fn release_url(version: Version) -> String {
    format!("https://github.com/{REPO_OWNER}/{REPO_NAME}/releases/tag/v{version}")
}

/// GitHub's `/releases/latest`, which returns the newest release that is
/// neither a draft nor a prerelease.
pub struct GithubReleaseSource {
    client: reqwest::Client,
    url: String,
}

impl GithubReleaseSource {
    pub fn new(user_agent: &str) -> Self {
        Self::with_url(user_agent, LATEST_RELEASE_URL)
    }

    /// Same adapter pointed somewhere else. Exists so the IPC tests can aim it
    /// at a dead local port and exercise the command wiring without touching
    /// GitHub.
    pub fn with_url(user_agent: &str, url: impl Into<String>) -> Self {
        ensure_crypto_provider();
        let client = reqwest::Client::builder()
            // GitHub answers 403 to a request with no User-Agent.
            .user_agent(user_agent)
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .build()
            .expect("failed to build the update-check http client");

        Self {
            client,
            url: url.into(),
        }
    }
}

impl ReleaseSource for GithubReleaseSource {
    async fn latest_release(&self) -> Result<ReleaseInfo, UpdateError> {
        let response = self
            .client
            .get(&self.url)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await
            .map_err(|err| UpdateError::Network(err.to_string()))?;

        let status = response.status();
        if !status.is_success() {
            let remaining = response
                .headers()
                .get("x-ratelimit-remaining")
                .and_then(|value| value.to_str().ok())
                .map(str::to_string);
            return Err(error_for_status(status.as_u16(), remaining.as_deref()));
        }

        let body = response
            .text()
            .await
            .map_err(|err| UpdateError::Network(err.to_string()))?;

        // Deliberately not surfacing serde's message: it quotes the response
        // body, which would put arbitrary network content in a user-facing
        // error string.
        let release: GithubRelease = serde_json::from_str(&body)
            .map_err(|_| UpdateError::Response("malformed release data".to_string()))?;

        release.into_info()
    }
}

/// Maps a non-2xx status onto the error the user eventually reads. Free
/// function so the whole table is testable without a socket.
pub fn error_for_status(status: u16, rate_limit_remaining: Option<&str>) -> UpdateError {
    match status {
        429 => UpdateError::RateLimited,
        403 if rate_limit_remaining == Some("0") => UpdateError::RateLimited,
        // Almost always a missing or blocked User-Agent, which is a bug on our
        // side rather than the user's - worth its own message.
        403 => UpdateError::Response("forbidden".to_string()),
        404 => UpdateError::Response("no published release".to_string()),
        other => UpdateError::Response(other.to_string()),
    }
}

/// Truncates on a *char* boundary. Release notes routinely contain emoji, and
/// slicing a `String` by byte index through a multi-byte char panics.
fn truncate_notes(body: String) -> String {
    match body.char_indices().nth(MAX_NOTES_CHARS) {
        Some((byte_index, _)) => format!("{}\n\n…", &body[..byte_index]),
        None => body,
    }
}

/// The subset of GitHub's release JSON this app reads. `serde` ignores the
/// dozens of other fields.
#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    published_at: Option<String>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

impl GithubRelease {
    fn into_info(self) -> Result<ReleaseInfo, UpdateError> {
        // `/releases/latest` already excludes drafts and prereleases; checking
        // anyway means a change in GitHub's behaviour can't quietly start
        // offering people release candidates.
        if self.draft || self.prerelease {
            return Err(UpdateError::Response(
                "no stable release published".to_string(),
            ));
        }

        Ok(ReleaseInfo {
            tag_name: self.tag_name,
            name: self.name.filter(|name| !name.trim().is_empty()),
            body: self
                .body
                .filter(|body| !body.trim().is_empty())
                .map(truncate_notes),
            published_at: self.published_at,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Trimmed from a real `/releases/latest` response - the fields we read,
    /// plus a couple we don't, to prove the extras are ignored.
    const REAL_RESPONSE: &str = r#"{
        "url": "https://api.github.com/repos/christoph-create/bme/releases/1",
        "html_url": "https://github.com/christoph-create/bme/releases/tag/v0.7.0",
        "id": 1,
        "tag_name": "v0.7.0",
        "target_commitish": "master",
        "name": "v0.7.0",
        "draft": false,
        "prerelease": false,
        "created_at": "2026-07-28T09:12:00Z",
        "published_at": "2026-07-28T09:20:31Z",
        "body": "Added\n- new set publish topic\n",
        "assets": []
    }"#;

    fn parse(body: &str) -> Result<ReleaseInfo, UpdateError> {
        serde_json::from_str::<GithubRelease>(body)
            .map_err(|_| UpdateError::Response("malformed release data".to_string()))
            .and_then(GithubRelease::into_info)
    }

    #[test]
    fn reads_a_real_release_response_and_ignores_the_fields_it_doesnt_use() {
        let info = parse(REAL_RESPONSE).unwrap();

        assert_eq!(
            info,
            ReleaseInfo {
                tag_name: "v0.7.0".to_string(),
                name: Some("v0.7.0".to_string()),
                body: Some("Added\n- new set publish topic\n".to_string()),
                published_at: Some("2026-07-28T09:20:31Z".to_string()),
            }
        );
    }

    #[test]
    fn a_null_body_becomes_no_notes() {
        let info = parse(r#"{"tag_name": "v0.7.0", "body": null}"#).unwrap();
        assert_eq!(info.body, None);
        assert_eq!(info.name, None);
        assert_eq!(info.published_at, None);
    }

    #[test]
    fn a_blank_body_becomes_no_notes() {
        let info = parse(r#"{"tag_name": "v0.7.0", "body": "   \n  "}"#).unwrap();
        assert_eq!(info.body, None);
    }

    #[test]
    fn a_response_without_a_tag_name_is_malformed() {
        assert_eq!(
            parse(r#"{"name": "v0.7.0"}"#),
            Err(UpdateError::Response("malformed release data".to_string()))
        );
    }

    #[test]
    fn a_draft_or_prerelease_is_never_offered() {
        for body in [
            r#"{"tag_name": "v0.8.0", "draft": true}"#,
            r#"{"tag_name": "v0.8.0", "prerelease": true}"#,
        ] {
            assert_eq!(
                parse(body),
                Err(UpdateError::Response(
                    "no stable release published".to_string()
                ))
            );
        }
    }

    #[test]
    fn maps_each_failing_status_to_its_own_error() {
        assert_eq!(error_for_status(429, None), UpdateError::RateLimited);
        assert_eq!(error_for_status(403, Some("0")), UpdateError::RateLimited);
        assert_eq!(
            error_for_status(403, Some("42")),
            UpdateError::Response("forbidden".to_string())
        );
        assert_eq!(
            error_for_status(403, None),
            UpdateError::Response("forbidden".to_string())
        );
        assert_eq!(
            error_for_status(404, None),
            UpdateError::Response("no published release".to_string())
        );
        assert_eq!(
            error_for_status(500, None),
            UpdateError::Response("500".to_string())
        );
    }

    #[test]
    fn long_notes_are_truncated_with_an_ellipsis() {
        let notes = "a".repeat(MAX_NOTES_CHARS + 100);
        let truncated = truncate_notes(notes);

        assert_eq!(truncated.chars().count(), MAX_NOTES_CHARS + 3);
        assert!(truncated.ends_with("\n\n…"));
    }

    #[test]
    fn notes_exactly_at_the_limit_are_left_alone() {
        let notes = "a".repeat(MAX_NOTES_CHARS);
        assert_eq!(truncate_notes(notes.clone()), notes);
    }

    #[test]
    fn truncating_multi_byte_notes_does_not_panic() {
        // A byte-index slice through any of these would panic.
        let notes = "🎉".repeat(MAX_NOTES_CHARS + 100);
        let truncated = truncate_notes(notes);

        assert!(truncated.ends_with("\n\n…"));
        assert_eq!(
            truncated.chars().filter(|c| *c == '🎉').count(),
            MAX_NOTES_CHARS
        );
    }

    #[test]
    fn the_release_url_is_built_from_the_version() {
        let version = Version {
            major: 0,
            minor: 8,
            patch: 0,
        };
        assert_eq!(
            release_url(version),
            "https://github.com/christoph-create/bme/releases/tag/v0.8.0"
        );
    }
}
