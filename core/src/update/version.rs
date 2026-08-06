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
    fn display_round_trips_through_parse_version() {
        let version = v(1, 20, 300);
        assert_eq!(version.to_string(), "1.20.300");
        assert_eq!(parse_version(&version.to_string()), Some(version));
    }
}
