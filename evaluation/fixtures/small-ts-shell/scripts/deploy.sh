#!/usr/bin/env bash
set -euo pipefail
DEPLOY_ENV="${DEPLOY_ENV:-staging}"
printf 'Deploying to %s\n' "$DEPLOY_ENV"
main() { printf 'release to %s\n' "$DEPLOY_ENV"; }
main "$@"
