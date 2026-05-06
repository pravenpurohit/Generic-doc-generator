#!/bin/bash
# Post-merge hook that rebuilds after merges

source "$SCRIPTS_ROOT/lib-utils.sh"

# Rebuild the project after merge
rebuild() {
  log_info "Rebuilding after merge..."
  ensure_dir "dist"
}

rebuild
