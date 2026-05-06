# Generic Doc Generator

Automated documentation generator for codebases. Produces architecture docs, script catalogs, cross-references, and narrative overviews from static analysis + optional LLM synthesis.

## Quick Start

```bash
# Document a target project
bash generate-all.sh --generate-all --target /path/to/your/project

# With LLM narrative synthesis (requires GEMINI_API_KEY or ANTHROPIC_API_KEY)
bash generate-all.sh --generate-all --synthesize --target /path/to/your/project
```

## Requirements

- Node.js 20+
- A `.docgen.yml` config file in the target project root

## What It Generates

| Output | Location | Description |
|--------|----------|-------------|
| Architecture overview | `<target>/docs/ARCHITECTURE.md` | System diagrams, layers, principles |
| Scripts catalog | `<target>/docs/SCRIPTS-CATALOG.md` | All scripts with descriptions |
| Getting started | `<target>/docs/GETTING-STARTED.md` | Quick-start commands, key concepts |
| Cross-reference | `<target>/docs/CROSS-REFERENCE.md` | Who-calls-whom index |
| Per-directory docs | `<target>/<dir>/README.generated.md` | Per-module documentation |
| Analysis data | `<target>/docs/analysis.json` | Structured analysis output |
| Narrative overview | `<target>/docs/TOOLKIT-OVERVIEW.md` | LLM-synthesized overview (with --synthesize) |

## Configuration

Create a `.docgen.yml` in your project root. See `docgen/` for the full config schema.

## Architecture

The tool uses a multi-pass pipeline:
1. Static analysis (tree-sitter + regex fallback) → dependency graph
2. Graph algorithms (SCC, layering, transitive reduction) → architecture model
3. Deterministic rendering → structural docs
4. LLM synthesis (optional) → narrative docs with 5-pass generate/red-team/revise pipeline
