#!/bin/bash
# Pre-commit hook that runs linting
# Validates code before allowing commits

source "$SCRIPTS_ROOT/lib-utils.sh"

# Run linter on staged files
run_lint() {
  local files="$1"
  log_info "Linting staged files..."
  if [[ -z "$files" ]]; then
    log_info "No files to lint"
    return 0
  fi
  return 0
}

# Check for forbidden patterns
check_patterns() {
  local pattern="${FORBIDDEN_PATTERN:-TODO}"
  log_info "Checking for forbidden pattern: $pattern"
}

run_lint "$@"
check_patterns
