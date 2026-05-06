#!/bin/bash
# Check that all dependencies are installed

source "$SCRIPTS_ROOT/lib-utils.sh"

# Verify node is available
check_node() {
  if ! command_exists node; then
    log_error "Node.js is not installed"
    exit 1
  fi
}

# Verify npm is available
check_npm() {
  if ! command_exists npm; then
    log_error "npm is not installed"
    exit 1
  fi
}

check_node
check_npm
log_info "All dependencies OK"
