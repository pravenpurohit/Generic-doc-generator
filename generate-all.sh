#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCGEN_BIN="$SCRIPT_DIR/docgen/dist/docgen.js"

GENERATE_ALL=0
SYNTHESIZE=0
VERBOSE=0
TARGET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --generate-all) GENERATE_ALL=1; shift ;;
    --synthesize)   SYNTHESIZE=1; shift ;;
    --verbose)      VERBOSE=1; shift ;;
    --target)       TARGET="$2"; shift 2 ;;
    *)              echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

if [[ "$GENERATE_ALL" -ne 1 ]]; then
  echo "Error: --generate-all flag is mandatory" >&2
  exit 2
fi

if [[ -z "$TARGET" ]]; then
  echo "Error: --target <path> flag is mandatory" >&2
  exit 2
fi

TARGET="$(cd "$TARGET" && pwd)"

if [[ ! -f "$TARGET/.docgen.yml" ]]; then
  echo "Error: No .docgen.yml found in $TARGET" >&2
  exit 2
fi

if [[ ! -f "$DOCGEN_BIN" ]]; then
  echo "Error: docgen not built. Run: cd $SCRIPT_DIR/docgen && npm install && npm run build" >&2
  exit 2
fi

if [[ -f "$TARGET/.kiro/.env" ]]; then
  set -a
  source "$TARGET/.kiro/.env"
  set +a
fi

VERBOSE_FLAG=""
if [[ "$VERBOSE" -eq 1 ]]; then
  VERBOSE_FLAG="--verbose"
fi

echo "=== Documenting: $TARGET ==="

echo "=== Step 1: docgen generate ==="
node "$DOCGEN_BIN" generate --config "$TARGET/.docgen.yml" --root "$TARGET" --output "$TARGET/docs" $VERBOSE_FLAG

SHXREF="$TARGET/tools/shxref/shxref.sh"
if [[ -f "$SHXREF" ]]; then
  echo "=== Step 2: shxref ==="
  bash "$SHXREF" --report "$TARGET" > "$TARGET/TRACEABILITY.md"
  echo "Wrote TRACEABILITY.md"
else
  echo "=== Step 2: Skipped (no shxref) ==="
fi

if [[ "$SYNTHESIZE" -eq 1 ]]; then
  echo "=== Step 3: docgen synthesize ==="
  node "$DOCGEN_BIN" synthesize --config "$TARGET/.docgen.yml" --root "$TARGET" --output "$TARGET/docs/TOOLKIT-OVERVIEW.md" $VERBOSE_FLAG
fi

echo "=== Done. Outputs in: $TARGET/docs/ ==="
