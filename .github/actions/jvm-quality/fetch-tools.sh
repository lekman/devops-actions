#!/usr/bin/env bash
# Downloads the standalone lint tools jvm-quality runs, each pinned to a
# version and checked against a SHA-256 before it is used. A file already
# in TOOLS_DIR (from the Actions cache) is checked the same way, so a
# cache entry cannot swap a tool.
#
#   TOOLS_DIR   where the tools go
#   NEED_KOTLIN "true" to fetch ktlint and detekt
#   NEED_JAVA   "true" to fetch google-java-format
#   MODE        "key" to only write the versions and the cache key as step
#               outputs, for the cache step that runs before the download
#
# Checksums:
#   ktlint              the digest GitHub records for the release asset
#   detekt-cli          the .sha256 Maven Central publishes beside the jar
#   google-java-format  the digest GitHub records for the release asset
set -euo pipefail

KTLINT_VERSION="1.8.0"
KTLINT_SHA256="a3fd620207d5c40da6ca789b95e7f823c54e854b7fade7f613e91096a3706d75"
DETEKT_VERSION="1.23.8"
DETEKT_SHA256="3afe89a11120303c73c9bdda3d8fe558dd9070a6937d27819ddc04b275381245"
GJF_VERSION="1.37.0"
GJF_SHA256="834b2a0c38cb774953322a84b5ca3f2f40dd3156650b3cd44d3b744345962f7a"

CACHE_KEY="jvm-tools-ktlint-${KTLINT_VERSION}-detekt-${DETEKT_VERSION}-gjf-${GJF_VERSION}"

if [ "${MODE:-}" = "key" ]; then
  {
    echo "ktlint=${KTLINT_VERSION}"
    echo "detekt=${DETEKT_VERSION}"
    echo "google-java-format=${GJF_VERSION}"
    echo "cache-key=${CACHE_KEY}"
    echo "versions=ktlint ${KTLINT_VERSION}, detekt ${DETEKT_VERSION}, google-java-format ${GJF_VERSION}"
  } >> "$GITHUB_OUTPUT"
  exit 0
fi

mkdir -p "$TOOLS_DIR"

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# fetch <url> <sha256> <file name>
fetch() {
  local url="$1" want="$2" dest="$TOOLS_DIR/$3"
  if [ -f "$dest" ] && [ "$(sha256 "$dest")" = "$want" ]; then
    echo "$3 is cached and matches its checksum"
    return 0
  fi
  curl --fail --silent --show-error --location --retry 3 --output "$dest.part" "$url"
  local got
  got="$(sha256 "$dest.part")"
  if [ "$got" != "$want" ]; then
    rm -f "$dest.part"
    echo "::error title=JVM Quality::checksum mismatch for $url: expected $want, got $got"
    exit 1
  fi
  mv "$dest.part" "$dest"
  echo "$3 downloaded and verified"
}

if [ "${NEED_KOTLIN:-false}" = "true" ]; then
  fetch "https://github.com/pinterest/ktlint/releases/download/${KTLINT_VERSION}/ktlint" \
    "$KTLINT_SHA256" ktlint
  fetch "https://repo1.maven.org/maven2/io/gitlab/arturbosch/detekt/detekt-cli/${DETEKT_VERSION}/detekt-cli-${DETEKT_VERSION}-all.jar" \
    "$DETEKT_SHA256" detekt-cli-all.jar
fi

if [ "${NEED_JAVA:-false}" = "true" ]; then
  fetch "https://github.com/google/google-java-format/releases/download/v${GJF_VERSION}/google-java-format-${GJF_VERSION}-all-deps.jar" \
    "$GJF_SHA256" google-java-format.jar
fi
