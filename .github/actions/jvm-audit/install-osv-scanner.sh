#!/usr/bin/env bash
# Downloads OSV-Scanner for this runner's OS and CPU, pinned to a version
# and checked against the SHA-256 the release publishes in
# osv-scanner_SHA256SUMS. The binary is used from a file, never from a
# shell pipe, and only after the checksum matches. Writes the binary's
# path as the `path` step output.
#
#   TOOLS_DIR   where the binary goes
set -euo pipefail

VERSION="2.7.1"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) asset="osv-scanner_linux_amd64"
    sum="fb7dab19a8bd9bbe5c3189f09d4b7ee1820c9553a23bac202648a56efd2f6ee8" ;;
  Linux-aarch64 | Linux-arm64) asset="osv-scanner_linux_arm64"
    sum="983d22fbad9724514e3fcc6acc83b5fa64c5ffa6b0d9f510028f22c1b223ff81" ;;
  Darwin-x86_64) asset="osv-scanner_darwin_amd64"
    sum="b8420d5485ba792626315f1bf9a5a2046e971d38eea75bf9090c38852dbc3b1b" ;;
  Darwin-arm64) asset="osv-scanner_darwin_arm64"
    sum="b22c02877a811c8f78956e8643efa554932b7378f590d13f8e97d4e9448a29f3" ;;
  *)
    echo "::warning title=JVM Audit::no OSV-Scanner build for $(uname -s) $(uname -m)"
    echo "path=" >> "$GITHUB_OUTPUT"
    exit 0
    ;;
esac

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

mkdir -p "$TOOLS_DIR"
dest="$TOOLS_DIR/osv-scanner-$VERSION"
if [ ! -f "$dest" ] || [ "$(sha256 "$dest")" != "$sum" ]; then
  curl --fail --silent --show-error --location --retry 3 --output "$dest.part" \
    "https://github.com/google/osv-scanner/releases/download/v${VERSION}/${asset}"
  got="$(sha256 "$dest.part")"
  if [ "$got" != "$sum" ]; then
    rm -f "$dest.part"
    echo "::error title=JVM Audit::checksum mismatch for $asset: expected $sum, got $got"
    echo "path=" >> "$GITHUB_OUTPUT"
    exit 0
  fi
  mv "$dest.part" "$dest"
fi
chmod +x "$dest"
"$dest" --version | head -n 1
echo "path=$dest" >> "$GITHUB_OUTPUT"
echo "version=$VERSION" >> "$GITHUB_OUTPUT"
