#!/usr/bin/env bash
# Bumps the project version across every file that needs to agree with it:
#   package.json, package-lock.json, src-tauri/tauri.conf.json,
#   src-tauri/Cargo.toml, core/Cargo.toml, and Cargo.lock.
#
# CI (.github/workflows/release.yml) checks that a pushed `v*` tag matches
# src-tauri/Cargo.toml, so that file is the source CI trusts; this script
# just keeps the others from drifting out of sync with it.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/bump-version.sh <major|minor|patch|release|X.Y.Z[-rc.N]>

Examples:
  scripts/bump-version.sh patch   # 0.2.0 -> 0.2.1
  scripts/bump-version.sh minor   # 0.2.0 -> 0.3.0
  scripts/bump-version.sh major   # 0.2.0 -> 1.0.0
  scripts/bump-version.sh 1.4.0   # set explicitly
  scripts/bump-version.sh 0.3.0-rc.1  # release candidate (public prerelease)
  scripts/bump-version.sh release # 0.3.0-rc.2 -> 0.3.0

Updates every version-bearing file, then leaves the changes staged in
your working tree for review. It does not commit or tag anything.
EOF
}

if [[ $# -ne 1 ]]; then
  usage >&2
  exit 1
fi

if [[ "$1" == "-h" || "$1" == "--help" ]]; then
  usage
  exit 0
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if ! command -v jq >/dev/null; then
  echo "error: jq is required but not found on PATH" >&2
  exit 1
fi

# Only `-rc.N` prereleases: WiX needs the version to stay close to numeric,
# and pacman/the in-app update check both know how to order exactly this form.
semver_re='^[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$'

current_version="$(jq -r .version package.json)"
if [[ ! "$current_version" =~ $semver_re ]]; then
  echo "error: package.json version '$current_version' isn't X.Y.Z or X.Y.Z-rc.N; bump it by hand" >&2
  exit 1
fi

case "$1" in
  release)
    if [[ "$current_version" != *-* ]]; then
      echo "error: 'release' finalises an rc, but $current_version isn't one" >&2
      exit 1
    fi
    new_version="${current_version%%-*}"
    ;;
  major | minor | patch)
    if [[ "$current_version" == *-* ]]; then
      echo "error: $current_version is an rc; use 'release' to finalise it, or set the next version explicitly" >&2
      exit 1
    fi
    IFS='.' read -r major minor patch <<<"$current_version"
    case "$1" in
      major) new_version="$((major + 1)).0.0" ;;
      minor) new_version="$major.$((minor + 1)).0" ;;
      patch) new_version="$major.$minor.$((patch + 1))" ;;
    esac
    ;;
  *)
    if [[ ! "$1" =~ $semver_re ]]; then
      echo "error: '$1' is neither major/minor/patch/release nor an X.Y.Z[-rc.N] version" >&2
      usage >&2
      exit 1
    fi
    new_version="$1"
    ;;
esac

if [[ "$new_version" == "$current_version" ]]; then
  echo "error: new version ($new_version) is the same as the current one" >&2
  exit 1
fi

echo "Bumping version: $current_version -> $new_version"

json_set_version() {
  local file="$1"
  shift
  local tmp
  tmp="$(mktemp)"
  jq --indent 2 --arg v "$new_version" "$*" "$file" >"$tmp"
  mv "$tmp" "$file"
}

json_set_version package.json '.version = $v'
json_set_version package-lock.json '.version = $v | .packages[""].version = $v'
json_set_version src-tauri/tauri.conf.json '.version = $v'

for cargo_toml in core/Cargo.toml src-tauri/Cargo.toml; do
  sed -i "s/^version = \"$current_version\"\$/version = \"$new_version\"/" "$cargo_toml"
done

# Regenerate Cargo.lock's version entries for the workspace-local crates.
if ! cargo check --workspace --offline >/dev/null 2>&1; then
  cargo check --workspace >/dev/null
fi

echo
echo "Updated files:"
git diff --stat -- package.json package-lock.json src-tauri/tauri.conf.json \
  core/Cargo.toml src-tauri/Cargo.toml Cargo.lock

cat <<EOF

Next steps:
  git diff                          # review
  git commit -am "Bump version to $new_version"
  git tag v$new_version
  git push && git push origin v$new_version
EOF

if [[ "$new_version" == *-* ]]; then
  cat <<EOF

The tag push builds v$new_version and publishes it straight away as a GitHub
*prerelease* (no MSI - WiX can't version an rc). The in-app update check
ignores it.
EOF
else
  cat <<EOF

The tag push builds v$new_version into a *draft* release only maintainers can
see. Test it, then press Publish on GitHub: that makes it public and offers
it through the in-app update check.
EOF
fi
