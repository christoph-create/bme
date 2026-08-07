use chrono::{DateTime, Duration, Utc};

use crate::models::{AvailableRelease, UpdateCheck};
use crate::storage::app_settings_repo::AppSettingsRepository;
use crate::update::github::release_url;
use crate::update::port::{ReleaseSource, UpdateError};
use crate::update::version::{is_newer, parse_version};
use crate::update::{LAST_CHECKED_AT_KEY, SKIPPED_VERSION_KEY};

/// How long a successful check counts for. Launching bme ten times a day
/// should cost one request, not ten.
pub const CHECK_INTERVAL_HOURS: i64 = 24;

/// Decides whether there's anything to tell the user about, and remembers
/// enough between runs not to ask GitHub more than once a day.
///
/// Generic over both collaborators the way `MqttClientManager` is generic over
/// `MqttPort`, so the tests drive the whole policy with a fake source and an
/// in-memory database and never open a socket.
pub struct UpdateChecker<S: ReleaseSource, R: AppSettingsRepository> {
    source: S,
    settings: R,
    current_version: String,
}

impl<S: ReleaseSource, R: AppSettingsRepository> UpdateChecker<S, R> {
    pub fn new(source: S, settings: R, current_version: impl Into<String>) -> Self {
        Self {
            source,
            settings,
            current_version: current_version.into(),
        }
    }

    /// `force` means the user pressed the button: it skips the daily throttle.
    /// It deliberately does *not* change what gets reported - `is_skipped` is a
    /// fact either way, and deciding to show a skipped version anyway is the
    /// caller's call.
    ///
    /// `now` is a parameter rather than a call to `Utc::now()` so the throttle
    /// is testable without a clock.
    pub async fn check(&self, force: bool, now: DateTime<Utc>) -> Result<UpdateCheck, UpdateError> {
        let current = parse_version(&self.current_version)
            .ok_or_else(|| UpdateError::UnknownCurrentVersion(self.current_version.clone()))?;

        if !force && self.is_within_check_interval(now)? {
            return Ok(UpdateCheck {
                current_version: current.to_string(),
                latest: None,
                throttled: true,
            });
        }

        let result = self.source.latest_release().await;

        // A rate limit means backing off for the day; a flaky connection means
        // trying again next launch. So the timestamp records "GitHub answered",
        // not "we tried".
        if matches!(result, Ok(_) | Err(UpdateError::RateLimited)) {
            self.settings.set(LAST_CHECKED_AT_KEY, &now.to_rfc3339())?;
        }

        let info = result?;

        // Not "no update available": the manual check must never claim you're
        // up to date when it couldn't actually tell.
        let latest = parse_version(&info.tag_name).ok_or_else(|| {
            UpdateError::Response(format!("unrecognised release tag {}", info.tag_name))
        })?;

        let skipped = self.settings.get(SKIPPED_VERSION_KEY)?;

        Ok(UpdateCheck {
            current_version: current.to_string(),
            latest: Some(AvailableRelease {
                is_newer: is_newer(current, latest),
                is_skipped: skipped.as_deref() == Some(latest.to_string().as_str()),
                url: release_url(latest),
                version: latest.to_string(),
                name: info.name,
                notes: info.body,
                published_at: info.published_at,
            }),
            throttled: false,
        })
    }

    /// Remembers that the user doesn't want to hear about this version again.
    /// Stored normalised, so `v0.8.0` and `0.8.0` are the same answer.
    pub fn skip_version(&self, version: &str) -> Result<(), UpdateError> {
        let parsed = parse_version(version)
            .ok_or_else(|| UpdateError::Response(format!("unrecognised version {version}")))?;
        self.settings
            .set(SKIPPED_VERSION_KEY, &parsed.to_string())?;
        Ok(())
    }

    /// Split out so the settings read - and any lock it takes - is finished
    /// well before `check` reaches its `.await`.
    fn is_within_check_interval(&self, now: DateTime<Utc>) -> Result<bool, UpdateError> {
        let Some(raw) = self.settings.get(LAST_CHECKED_AT_KEY)? else {
            return Ok(false);
        };
        let Ok(last) = DateTime::parse_from_rfc3339(&raw) else {
            // An unreadable timestamp is treated as "never checked" rather than
            // as an error - it would otherwise wedge the feature permanently.
            return Ok(false);
        };
        Ok(now.signed_duration_since(last.with_timezone(&Utc))
            < Duration::hours(CHECK_INTERVAL_HOURS))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::storage::app_settings_repo::SqliteAppSettingsRepository;
    use crate::storage::open_in_memory;
    use crate::update::port::ReleaseInfo;

    struct FakeReleaseSource {
        result: Result<ReleaseInfo, UpdateError>,
        calls: Arc<AtomicUsize>,
    }

    impl FakeReleaseSource {
        fn tagged(tag: &str) -> Self {
            Self::returning(Ok(ReleaseInfo {
                tag_name: tag.to_string(),
                name: Some("A release".to_string()),
                body: Some("notes".to_string()),
                published_at: Some("2026-08-01T00:00:00Z".to_string()),
            }))
        }

        fn returning(result: Result<ReleaseInfo, UpdateError>) -> Self {
            Self {
                result,
                calls: Arc::new(AtomicUsize::new(0)),
            }
        }
    }

    impl ReleaseSource for FakeReleaseSource {
        async fn latest_release(&self) -> Result<ReleaseInfo, UpdateError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.result.clone()
        }
    }

    fn settings() -> SqliteAppSettingsRepository {
        SqliteAppSettingsRepository::new(Arc::new(Mutex::new(open_in_memory())))
    }

    fn checker(
        source: FakeReleaseSource,
    ) -> (
        UpdateChecker<FakeReleaseSource, SqliteAppSettingsRepository>,
        Arc<AtomicUsize>,
        SqliteAppSettingsRepository,
    ) {
        let calls = Arc::clone(&source.calls);
        let repo = settings();
        let checker = UpdateChecker::new(source, repo.clone(), "0.7.0");
        (checker, calls, repo)
    }

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-08-06T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    #[tokio::test]
    async fn a_first_check_calls_out_and_records_the_timestamp() {
        let (checker, calls, repo) = checker(FakeReleaseSource::tagged("v0.8.0"));

        let result = checker.check(false, now()).await.unwrap();

        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(!result.throttled);
        assert!(repo.get(LAST_CHECKED_AT_KEY).unwrap().is_some());
    }

    #[tokio::test]
    async fn a_second_check_within_the_interval_is_throttled_without_a_network_call() {
        let (checker, calls, _) = checker(FakeReleaseSource::tagged("v0.8.0"));
        checker.check(false, now()).await.unwrap();

        let result = checker
            .check(false, now() + Duration::hours(1))
            .await
            .unwrap();

        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(result.throttled);
        assert_eq!(result.latest, None);
    }

    #[tokio::test]
    async fn forcing_bypasses_the_throttle() {
        let (checker, calls, _) = checker(FakeReleaseSource::tagged("v0.8.0"));
        checker.check(false, now()).await.unwrap();

        let result = checker
            .check(true, now() + Duration::hours(1))
            .await
            .unwrap();

        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert!(!result.throttled);
    }

    #[tokio::test]
    async fn the_throttle_expires_after_the_interval() {
        let (checker, calls, _) = checker(FakeReleaseSource::tagged("v0.8.0"));
        checker.check(false, now()).await.unwrap();

        let result = checker
            .check(false, now() + Duration::hours(CHECK_INTERVAL_HOURS + 1))
            .await
            .unwrap();

        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert!(!result.throttled);
    }

    #[tokio::test]
    async fn a_newer_tag_is_reported_as_newer() {
        let (checker, _, _) = checker(FakeReleaseSource::tagged("v0.8.0"));

        let release = checker.check(false, now()).await.unwrap().latest.unwrap();

        assert_eq!(release.version, "0.8.0");
        assert!(release.is_newer);
        assert!(!release.is_skipped);
        assert_eq!(
            release.url,
            "https://github.com/christoph-create/bme/releases/tag/v0.8.0"
        );
    }

    #[tokio::test]
    async fn the_running_version_is_not_newer_than_itself() {
        let (checker, _, _) = checker(FakeReleaseSource::tagged("v0.7.0"));

        let release = checker.check(false, now()).await.unwrap().latest.unwrap();

        assert!(!release.is_newer);
    }

    #[tokio::test]
    async fn an_older_release_is_not_reported_as_newer() {
        let (checker, _, _) = checker(FakeReleaseSource::tagged("v0.6.1"));

        let release = checker.check(false, now()).await.unwrap().latest.unwrap();

        assert!(!release.is_newer);
    }

    #[tokio::test]
    async fn a_skipped_version_is_still_reported_as_newer() {
        // The backend reports facts; hiding a skipped release is the caller's
        // decision, and a manual check deliberately overrides it.
        let (checker, _, _) = checker(FakeReleaseSource::tagged("v0.8.0"));
        checker.skip_version("0.8.0").unwrap();

        let release = checker.check(true, now()).await.unwrap().latest.unwrap();

        assert!(release.is_newer);
        assert!(release.is_skipped);
    }

    #[tokio::test]
    async fn skipping_a_version_normalises_the_tag_form() {
        let (checker, _, repo) = checker(FakeReleaseSource::tagged("v0.8.0"));

        checker.skip_version("v0.8.0").unwrap();

        assert_eq!(
            repo.get(SKIPPED_VERSION_KEY).unwrap(),
            Some("0.8.0".to_string())
        );
    }

    #[tokio::test]
    async fn skipping_one_version_does_not_hide_the_next() {
        let (checker, _, _) = checker(FakeReleaseSource::tagged("v0.9.0"));
        checker.skip_version("0.8.0").unwrap();

        let release = checker.check(false, now()).await.unwrap().latest.unwrap();

        assert!(release.is_newer);
        assert!(!release.is_skipped);
    }

    #[tokio::test]
    async fn a_network_failure_does_not_burn_the_daily_check() {
        let (checker, calls, repo) = checker(FakeReleaseSource::returning(Err(
            UpdateError::Network("dns".to_string()),
        )));

        assert!(checker.check(false, now()).await.is_err());

        assert_eq!(repo.get(LAST_CHECKED_AT_KEY).unwrap(), None);
        let _ = checker.check(false, now()).await;
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn a_rate_limit_does_back_off() {
        let (checker, calls, _) =
            checker(FakeReleaseSource::returning(Err(UpdateError::RateLimited)));

        assert!(checker.check(false, now()).await.is_err());
        let result = checker
            .check(false, now() + Duration::hours(1))
            .await
            .unwrap();

        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(result.throttled);
    }

    #[tokio::test]
    async fn an_unrecognised_tag_is_an_error_not_a_silent_up_to_date() {
        let (checker, _, _) = checker(FakeReleaseSource::tagged("nightly"));

        let err = checker.check(false, now()).await.unwrap_err();

        assert!(matches!(err, UpdateError::Response(msg) if msg.contains("nightly")));
    }

    #[tokio::test]
    async fn a_prerelease_that_slips_through_is_never_offered() {
        let (checker, _, _) = checker(FakeReleaseSource::tagged("v0.8.0-rc.1"));

        assert!(matches!(
            checker.check(false, now()).await,
            Err(UpdateError::Response(_))
        ));
    }

    #[tokio::test]
    async fn an_unparseable_current_version_is_rejected_before_calling_out() {
        let source = FakeReleaseSource::tagged("v0.8.0");
        let calls = Arc::clone(&source.calls);
        let checker = UpdateChecker::new(source, settings(), "dev");

        let err = checker.check(false, now()).await.unwrap_err();

        assert_eq!(err, UpdateError::UnknownCurrentVersion("dev".to_string()));
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn an_unreadable_stored_timestamp_is_treated_as_never_checked() {
        let (checker, calls, repo) = checker(FakeReleaseSource::tagged("v0.8.0"));
        repo.set(LAST_CHECKED_AT_KEY, "not a timestamp").unwrap();

        let result = checker.check(false, now()).await.unwrap();

        assert!(!result.throttled);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
}
