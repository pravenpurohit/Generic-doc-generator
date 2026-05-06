#!/bin/bash
# Check environment variables are set correctly

source "$SCRIPTS_ROOT/lib-utils.sh"

# Verify required env vars
check_required_vars() {
  local missing=0
  if [[ -z "${PROJECT_ROOT:-}" ]]; then
    log_error "PROJECT_ROOT is not set"
    missing=1
  fi
  if [[ -z "${CI:-}" ]]; then
    log_info "Not running in CI"
  fi
  return $missing
}

check_required_vars
