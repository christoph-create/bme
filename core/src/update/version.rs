use std::fmt;

/// A release version as bme tags them: `vX.Y.Z`, exactly three numeric parts.
///
/// Field order *is* the comparison order - the derived `Ord` is the whole
/// point of this type, so don't reorder the fields.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Version {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
}

/// Parses `v0.7.0` or `0.7.0`, and nothing else.
///
/// Prerelease tags (`v0.8.0-rc.1`) and build metadata (`v0.8.0+ci.4`) are
/// rejected rather than having their suffix stripped: this feature must never
/// offer a prerelease, and quietly treating `v0.8.0-rc.1` as `0.8.0` would do
/// exactly that. A tag we can't read is safer as "nothing to offer" than as a
/// guess.
pub fn parse_version(raw: &str) -> Option<Version> {
    let trimmed = raw.trim();
    let stripped = trimmed
        .strip_prefix('v')
        .or_else(|| trimmed.strip_prefix('V'))
        .unwrap_or(trimmed);

    if stripped.contains('-') || stripped.contains('+') {
        return None;
    }

    let mut parts = stripped.split('.');
    // `u64::from_str` rejects empty strings, whitespace and a leading `+`, so
    // "v1..3", "v 1.2.3" and "" all fall out here for free.
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }

    Some(Version {
        major,
        minor,
        patch,
    })
}

/// The version of the running build. Unlike a release tag this may be an rc
/// (`0.10.0-rc.1`), because rc builds are shipped to testers - and those must
/// still be offered the final `0.10.0` once it's out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CurrentVersion {
    pub base: Version,
    pub rc: Option<u64>,
}

/// Like [`parse_version`], plus exactly the `-rc.N` suffix
/// `scripts/bump-version.sh` produces. Only ever applied to our own version:
/// release tags stay strict, so a prerelease is still never *offered*.
pub fn parse_current_version(raw: &str) -> Option<CurrentVersion> {
    let trimmed = raw.trim();
    let (base, rc) = match trimmed.split_once("-rc.") {
        Some((base, n)) => (base, Some(n.parse().ok()?)),
        None => (trimmed, None),
    };
    Some(CurrentVersion {
        base: parse_version(base)?,
        rc,
    })
}

/// [`is_newer`] for a running build: an rc counts as older than its own final
/// release, so `0.10.0-rc.2` is offered `0.10.0`.
pub fn is_newer_than_current(current: CurrentVersion, latest: Version) -> bool {
    is_newer(current.base, latest) || (current.rc.is_some() && latest == current.base)
}

impl fmt::Display for CurrentVersion {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.rc {
            Some(n) => write!(f, "{}-rc.{n}", self.base),
            None => write!(f, "{}", self.base),
        }
    }
}

/// True when `latest` is strictly newer than `current`. Equal is not newer,
/// and older is never newer - a downgrade must never be offered.
pub fn is_newer(current: Version, latest: Version) -> bool {
    latest > current
}

impl fmt::Display for Version {
    /// The normalised form, without the `v` - this is what gets persisted as
    /// the skipped version and what the UI shows.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(major: u64, minor: u64, patch: u64) -> Version {
        Version {
            major,
            minor,
            patch,
        }
    }

    #[test]
    fn parses_a_release_tag() {
        assert_eq!(parse_version("v0.7.0"), Some(v(0, 7, 0)));
        assert_eq!(parse_version("V1.2.3"), Some(v(1, 2, 3)));
    }

    #[test]
    fn parses_a_bare_version() {
        assert_eq!(parse_version("0.7.0"), Some(v(0, 7, 0)));
        assert_eq!(parse_version("  0.7.0 "), Some(v(0, 7, 0)));
    }

    #[test]
    fn rejects_a_prerelease_tag() {
        assert_eq!(parse_version("v0.8.0-rc.1"), None);
        assert_eq!(parse_version("v0.8.0-beta"), None);
    }

    #[test]
    fn rejects_build_metadata() {
        assert_eq!(parse_version("v0.8.0+build.4"), None);
    }

    #[test]
    fn rejects_anything_that_isnt_three_numbers() {
        for raw in ["v1.2", "v1.2.3.4", "latest", "", "v", "v1.2.x", "v 1.2.3"] {
            assert_eq!(parse_version(raw), None, "expected {raw:?} to be rejected");
        }
    }

    #[test]
    fn ten_is_newer_than_nine() {
        // The one a string comparison gets wrong, at the one release where it
        // matters and nobody thinks to re-test.
        assert!(is_newer(v(0, 9, 0), v(0, 10, 0)));
        assert!(!is_newer(v(0, 10, 0), v(0, 9, 0)));
    }

    #[test]
    fn equal_versions_are_not_newer() {
        assert!(!is_newer(v(0, 7, 0), v(0, 7, 0)));
    }

    #[test]
    fn an_older_release_is_never_offered() {
        assert!(!is_newer(v(1, 0, 0), v(0, 9, 9)));
    }

    #[test]
    fn major_beats_minor_beats_patch() {
        assert!(is_newer(v(0, 99, 99), v(1, 0, 0)));
        assert!(is_newer(v(0, 7, 99), v(0, 8, 0)));
        assert!(is_newer(v(0, 7, 0), v(0, 7, 1)));
    }

    #[test]
    fn current_version_accepts_an_rc_suffix() {
        let rc = |n| CurrentVersion {
            base: v(0, 10, 0),
            rc: Some(n),
        };
        assert_eq!(parse_current_version("0.10.0-rc.2"), Some(rc(2)));
        assert_eq!(parse_current_version("v0.10.0-rc.2"), Some(rc(2)));
        assert_eq!(
            parse_current_version("0.10.0"),
            Some(CurrentVersion {
                base: v(0, 10, 0),
                rc: None
            })
        );
    }

    #[test]
    fn current_version_rejects_other_prerelease_forms() {
        for raw in [
            "0.10.0-beta",
            "0.10.0-rc",
            "0.10.0-rc.x",
            "0.10.0-rc.1+b",
            "dev",
        ] {
            assert_eq!(
                parse_current_version(raw),
                None,
                "expected {raw:?} to be rejected"
            );
        }
    }

    #[test]
    fn an_rc_is_older_than_its_own_release() {
        let rc = CurrentVersion {
            base: v(0, 10, 0),
            rc: Some(1),
        };
        assert!(is_newer_than_current(rc, v(0, 10, 0)));
        assert!(is_newer_than_current(rc, v(0, 10, 1)));
        assert!(!is_newer_than_current(rc, v(0, 9, 9)));
    }

    #[test]
    fn a_final_release_is_not_newer_than_itself() {
        let current = CurrentVersion {
            base: v(0, 10, 0),
            rc: None,
        };
        assert!(!is_newer_than_current(current, v(0, 10, 0)));
    }

    #[test]
    fn current_version_display_keeps_the_rc_suffix() {
        assert_eq!(
            parse_current_version("v0.10.0-rc.3").unwrap().to_string(),
            "0.10.0-rc.3"
        );
    }

    #[test]
    fn display_round_trips_through_parse_version() {
        let version = v(1, 20, 300);
        assert_eq!(version.to_string(), "1.20.300");
        assert_eq!(parse_version(&version.to_string()), Some(version));
    }
}
