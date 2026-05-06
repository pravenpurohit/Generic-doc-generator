#!/bin/bash
# Bootstrap script for project initialization
# Sets up the environment and installs dependencies

source "$SCRIPTS_ROOT/lib-utils.sh"

PROJECT_ROOT="${PROJECT_ROOT:-$(pwd)}"
VERBOSE="${VERBOSE:-false}"

# Set up the project environment
setup_env() {
  log_info "Setting up environment..."
  ensure_dir "$PROJECT_ROOT/.cache"
  export PATH="$PROJECT_ROOT/bin:$PATH"
}

# Install project dependencies
install_deps() {
  log_info "Installing dependencies..."
  if command_exists npm; then
    npm install
  else
    log_error "npm not found"
    exit 1
  fi
}

# Main entry point
main() {
  setup_env
  install_deps
  log_info "Bootstrap complete"
}

main "$@"
