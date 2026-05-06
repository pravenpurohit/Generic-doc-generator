#!/bin/bash
# Shared utility functions for the project
# Provides common helpers used across scripts

# Log a message with timestamp
log_info() {
  echo "[INFO] $(date +%H:%M:%S) $1"
}

# Log an error message
log_error() {
  echo "[ERROR] $(date +%H:%M:%S) $1" >&2
}

# Check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Ensure a directory exists
ensure_dir() {
  local dir="$1"
  if [[ ! -d "$dir" ]]; then
    mkdir -p "$dir"
  fi
}
