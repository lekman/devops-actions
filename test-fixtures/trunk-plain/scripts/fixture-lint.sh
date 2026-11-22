#!/usr/bin/env bash
# Leaves a marker in the repository root, so CI can tell the linter ran.
set -euo pipefail
touch "$1/.fixture-lint-ran"
