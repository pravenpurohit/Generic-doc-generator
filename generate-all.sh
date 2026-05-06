#!/usr/bin/env bash
# generate-all.sh — Unified invocation for all documentation generation tools.
# Runs docgen, shxref, and workspace-audit in sequence.
#
# Usage:
#   bash tools/generate-all.sh --generate-all [--synthesize] [--verbose]
#
# Flags:
#   --generate-all   (MANDATORY) Run all documentation generators
#   --synthesize     Also run LLM synthesis (requires GEMINI_API_KEY or ANTHROPIC_API_KEY)
#   --verbose        Show detailed output from each tool
#
# Outputs:
#   _generated-docs-new/          docgen static analysis + rendered markdown
#   TRACEABILITY.md               shxref cross-reference matrix
#   tools/workspace-audit/runs/   workspace-audit integrity report

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GENERATE_ALL=0
SYNTHESIZE=0
VERBOSE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --generate-all) GENERATE_ALL=1; shift ;;
    --synthesize)   SYNTHESIZE=1; shift ;;
    --verbose)      VERBOSE=1; shift ;;
    *)              echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

if [[ "$GENERATE_ALL" -ne 1 ]]; then
  echo "Error: --generate-all flag is mandatory" >&2
  echo "Usage: bash tools/generate-all.sh --generate-all [--synthesize] [--verbose]" >&2
  exit 2
fi

cd "$ROOT_DIR"

VERBOSE_FLAG=""
if [[ "$VERBOSE" -eq 1 ]]; then
  VERBOSE_FLAG="--verbose"
fi

echo "=== Step 1/3: Running docgen (static analysis + rendering) ==="
node tools/docgen/dist/docgen.js generate $VERBOSE_FLAG
echo ""

echo "=== Step 2/3: Running shxref (cross-reference matrix) ==="
bash tools/shxref/shxref.sh --report . > TRACEABILITY.md
echo "Wrote TRACEABILITY.md"
echo ""

echo "=== Step 3/3: Running workspace-audit (integrity report) ==="
bash tools/workspace-audit/workspace-audit.sh --report . > /dev/null
echo "Wrote workspace-audit report to tools/workspace-audit/runs/"
echo ""

if [[ "$SYNTHESIZE" -eq 1 ]]; then
  echo "=== Step 4/4: Running docgen synthesize (LLM narrative generation) ==="
  node tools/docgen/dist/docgen.js synthesize $VERBOSE_FLAG
  echo ""
fi

echo "=== All tools completed ==="
echo "Outputs:"
echo "  _generated-docs-new/                    (docgen: analysis + rendered docs)"
echo "  TRACEABILITY.md                         (shxref: cross-reference matrix)"
echo "  tools/workspace-audit/runs/<timestamp>/ (workspace-audit: integrity report)"
if [[ "$SYNTHESIZE" -eq 1 ]]; then
  echo "  _generated-docs-new/TOOLKIT-OVERVIEW-GENERATED.md (LLM synthesis)"
fi
