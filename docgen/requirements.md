# Documentation Generator (`docgen`) — Requirements

## 1. Overview

This document defines the requirements for a static-analysis-only documentation generator that produces accurate, maintainable Markdown documentation with multi-level Mermaid diagrams generated from actual graph data. The tool analyzes shell scripts (Phase 1) and TypeScript files (Phase 2), extracts structural information, and renders multi-level documentation without any LLM API calls.

Primary value proposition: replacing hardcoded or absent diagrams with automatically generated, multi-level Mermaid diagrams derived from real dependency graph analysis.

---

## 2. Functional Requirements

### 2.1 Phase 1 — Shell Analysis + Graph + Rendering

#### FR-001: Shell Script Parsing

The tool SHALL parse all `.sh` and `.bash` files using web-tree-sitter with the tree-sitter-bash WASM grammar, producing a full concrete syntax tree (CST) for each file.

#### FR-002: Function Extraction

The tool SHALL extract all function definitions from shell scripts, including:
- Function name
- Start and end line numbers
- Parameters (positional: `$1`, `$2`, etc.)
- Environment variables read or written
- Local variables declared with `local`

#### FR-003: Source Chain Resolution

The tool SHALL follow `source` and `.` (dot) include statements to build inter-file dependency edges. For source statements with variable paths (e.g., `source "$SCRIPTS_ROOT/lib.sh"`), the tool SHALL resolve them using the `sourcePathMappings` configuration. Unresolvable source paths SHALL be logged as warnings and marked as unresolved edges.

#### FR-004: Entry Point Detection

The tool SHALL detect entry point scripts by identifying files with:
- A shebang line (`#!/bin/bash`, `#!/usr/bin/env bash`, etc.) AND executable permissions
- Or explicit listing in configuration

#### FR-005: Environment Variable Tracking

The tool SHALL extract environment variable usage from shell scripts, distinguishing between:
- Variables read (referenced with `$VAR` or `${VAR}`)
- Variables written (assigned with `VAR=value` or `export VAR=value`)
- Variables with defaults (`${VAR:-default}`)

#### FR-006: Graph Construction

The tool SHALL build a directed graph (custom adjacency-list representation) where:
- Nodes represent entities (functions, scripts, modules)
- Edges represent relationships (calls, sources, imports, spawns)
- Each edge has a kind and weight

#### FR-007: SCC Condensation

The tool SHALL run Tarjan's Strongly Connected Components algorithm on the graph to collapse mutual recursion into single composite nodes. The condensed graph SHALL be a DAG.

#### FR-008: Transitive Reduction

The tool SHALL compute the transitive reduction of the condensed DAG and mark each edge with an `inTransitiveReduction` boolean. This marking is used for diagram filtering ONLY — the underlying data model retains ALL edges.

#### FR-009: Degree-Based Importance

The tool SHALL compute importance scores for each entity based on fan-in (incoming edges) plus fan-out (outgoing edges).

#### FR-010: Layer Assignment

The tool SHALL assign architectural layers to entities using the longest-path algorithm on the condensed DAG. Layer 0 represents infrastructure/utilities; higher layers represent orchestration/entry points.

#### FR-011: Directory-Structure Grouping

The tool SHALL group entities by their containing directory. No community detection algorithm is required for Phase 1.

#### FR-012: Convention Detection

The tool SHALL detect naming conventions and directory roles by analyzing patterns in filenames and directory structure (e.g., `hook-*.sh` implies lifecycle hooks, `lib-*.sh` implies shared libraries).

#### FR-013: Analysis JSON Serialization

The tool SHALL produce an `analysis.json` file as the first output artifact. This file is the architectural boundary between analysis and rendering. It SHALL be:
- Cacheable (deterministic output for same input)
- Diffable (stable key ordering)
- Inspectable (human-readable JSON)

#### FR-014: Architecture Overview Rendering

The tool SHALL render an `ARCHITECTURE.md` file containing:
- Project name and description (from config)
- System overview with an L0 Mermaid diagram (directory groups as nodes, inter-group edges)
- Layer descriptions
- Authored principles and design decisions (from config)

#### FR-015: Per-Directory README Rendering

The tool SHALL render a `README.md` for each analyzed directory containing:
- Directory purpose (from convention detection or config narrative)
- L1 Mermaid diagram (functions within the directory and their relationships)
- List of scripts/modules with descriptions
- Authored narrative (from config, if provided)

#### FR-016: Script Catalog Rendering

The tool SHALL render a `SCRIPTS-CATALOG.md` containing a searchable index of all analyzed scripts with:
- Script name and path
- Brief description (from comments or config)
- Entry point status
- Category/group assignment

#### FR-017: Cross-Reference Index

The tool SHALL render a cross-reference index showing which entities call/depend on which other entities, organized for lookup.

#### FR-018: Multi-Level Mermaid Diagrams

The tool SHALL generate Mermaid diagrams at three levels:
- **L0 (System Overview)**: Directory groups as nodes, inter-group edges, transitive reduction applied. Target: 5-15 nodes.
- **L1 (Module Detail)**: Functions within one directory/group. Target: 10-30 nodes.
- **L2 (Flow Detail)**: Specific call chain from entry point to leaf. Target: 5-15 nodes.

#### FR-019: Authored Content Injection

The tool SHALL inject human-authored content from `.docgen.yml` into generated documentation at appropriate locations:
- Glossary terms
- Module narratives (per-directory explanations)
- Architectural principles
- Design decisions
- Behavioral diagrams (Mermaid sequences that cannot be auto-generated)

#### FR-020: CLI Interface

The tool SHALL provide a CLI with at minimum:
- `docgen generate` — full pipeline (analysis + rendering)
- `docgen generate --json-only` — produce only `analysis.json` (no rendering)

---

### 2.2 Phase 2 — TypeScript Analysis

#### FR-021: TypeScript Parsing

The tool SHALL parse `.ts` and `.tsx` files using ts-morph with type checking disabled (structural analysis only).

#### FR-022: TypeScript Entity Extraction

The tool SHALL extract from TypeScript files:
- Exported functions with signatures
- Classes with methods and properties
- Interfaces and type aliases
- JSDoc descriptions
- Import/export relationships

#### FR-023: TypeScript Import Graph

The tool SHALL build a module dependency graph from TypeScript import statements using bulk import/export analysis (not per-symbol `findReferences()`).

#### FR-024: Cross-Language Edge Detection

The tool SHALL detect cross-language invocations:
- Shell scripts invoking TypeScript (via `node`, `ts-node`, `npx` patterns)
- TypeScript invoking shell scripts (via `child_process`, `exec`, `spawn` patterns)

---

### 2.3 Phase 3 — Advanced Graph Algorithms (Only If Needed)

#### FR-025: Community Detection

The tool MAY implement Louvain community detection (via graphology) to group related functions that span directories. This is only required if directory-structure grouping proves insufficient.

#### FR-026: PageRank Importance

The tool MAY implement PageRank (via graphology) to replace degree-based importance ranking if the simpler metric proves insufficient.

#### FR-027: Edge Betweenness Centrality

The tool MAY implement edge betweenness centrality (via graphology) for better edge filtering in complex diagrams, only if transitive reduction leaves too many edges.

---

## 3. Non-Functional Requirements

#### NFR-001: No LLM Dependency

The tool SHALL NOT make any LLM API calls. All analysis and rendering is purely static, works offline, and produces deterministic output.

#### NFR-002: Performance — Total Execution Time

The tool SHALL complete a full pipeline run (analysis + rendering) in under 5 seconds for a codebase of up to 500 files.

#### NFR-003: Performance — Graph Algorithms

The graph algorithm pipeline (SCC + transitive reduction + degree counting + longest-path) SHALL execute in under 50ms for graphs with up to 500 nodes and 1500 edges.

#### NFR-004: Performance — Memory

The tool SHALL use less than 1 MB of memory for graph data structures on a graph with 500 nodes and 1500 edges. Total process memory (including WASM runtime) SHALL remain under 200 MB.

#### NFR-005: Performance — WASM Initialization

The web-tree-sitter WASM initialization budget is 200-500ms on first parse. The parser instance SHALL be reused across files to avoid repeated initialization.

#### NFR-006: Performance — TypeScript Analysis (Phase 2)

ts-morph initialization and analysis SHALL complete within 1-3 seconds for up to 50 TypeScript files.

#### NFR-007: Portability

The tool SHALL run on any platform with Node.js 18+ installed. The WASM variant of tree-sitter is chosen specifically for cross-platform portability (no native compilation required).

#### NFR-008: Zero Runtime Dependency for Consumers

Consumer projects SHALL NOT need to install anything to use the generated documentation. Only toolkit developers need the generator installed. Output is plain Markdown + Mermaid (renders natively on GitHub/GitLab).

#### NFR-009: Deterministic Output

Given the same input files and configuration, the tool SHALL produce byte-identical output. This enables meaningful diffs of generated documentation.

#### NFR-010: Minimal Runtime Dependencies (Phase 1)

Phase 1 SHALL have exactly 2 runtime dependencies:
- `web-tree-sitter`
- `tree-sitter-bash` (WASM binary)

No graphology, no template engines, no utility libraries.

#### NFR-011: Single-File Distribution

The tool SHALL be bundleable into a single `.js` file via esbuild for simplified distribution. Node.js startup overhead budget: ~50ms.

#### NFR-012: WASM Memory Management

The tool SHALL explicitly call `delete()` on tree-sitter trees after extraction to prevent WASM memory leaks.

#### NFR-013: Testability

All core algorithms SHALL be implemented as pure functions (data in, result out) to enable straightforward unit testing without filesystem or I/O mocking.

---

## 4. Input/Output Specifications

### 4.1 Inputs

#### IO-001: Source Files

- **Shell scripts**: Files matching `*.sh` and `*.bash` patterns within configured include paths
- **TypeScript files** (Phase 2): Files matching `*.ts` and `*.tsx` patterns within configured include paths
- Files are read from the filesystem relative to the project root

#### IO-002: Configuration File

- Path: `.docgen.yml` at the project root (or specified via CLI flag)
- Format: YAML
- Required fields: `project.name`, `include` patterns
- Optional fields: all others (see Section 5)

#### IO-003: File Discovery

The tool SHALL discover files by:
1. Applying `include` glob patterns from configuration
2. Excluding files matching `exclude` glob patterns
3. Producing a `FileManifest[]` with path, language, size, and mtime for each file

### 4.2 Outputs

#### IO-004: Intermediate Format (`analysis.json`)

The primary intermediate output. Schema:

```
analysis.json
  meta:          { version, generatedAt, rootDir, config }
  files:         FileEntry[]
  entities:      Entity[]
  edges:         Edge[]
  groups:        Group[]
  layers:        Layer[]
  conventions:   Convention[]
```

Each entity has: id (unique: `file:path#name`), kind, name, filePath, location, signature, parameters, envVars, exitCodes, fanIn, fanOut, importance, layer, group.

Each edge has: source (entity ID), target (entity ID), kind, weight, inTransitiveReduction.

#### IO-005: Generated Documentation Files

Output directory structure (configurable, default `_generated-docs`):

```
<output-dir>/
  ARCHITECTURE.md          — System overview + L0 diagram
  SCRIPTS-CATALOG.md       — Searchable script index
  <directory>/
    README.md              — Per-directory documentation + L1 diagram
```

#### IO-006: Mermaid Diagram Format

All diagrams SHALL use Mermaid `flowchart TD` syntax enclosed in fenced code blocks. Diagrams SHALL:
- Use `subgraph` blocks for directory groups
- Use descriptive node labels (not raw IDs)
- Apply edge filtering (transitive reduction for L0)
- Target readability: edges < 2x nodes

#### IO-007: Warning/Error Output

The tool SHALL output warnings to stderr for:
- Unresolvable source paths (variable paths not in `sourcePathMappings`)
- Files that fail to parse (syntax errors)
- Entities with unresolved cross-file references

Errors (causing non-zero exit) SHALL be limited to:
- Configuration file not found or invalid
- No files matching include patterns
- Output directory not writable

---

## 5. Configuration Schema Requirements

### CS-001: Top-Level Structure

The `.docgen.yml` file SHALL support the following top-level keys:

```yaml
project:             # Project metadata
include:             # File inclusion glob patterns (required)
exclude:             # File exclusion glob patterns
output:              # Output configuration
sourcePathMappings:  # Variable-to-path mappings for shell source resolution
authored:            # Human-authored content for injection
```

### CS-002: Project Metadata

```yaml
project:
  name: string       # Required. Project display name.
  description: string # Optional. Multi-line project description.
```

### CS-003: Include/Exclude Patterns

```yaml
include:             # Required. At least one pattern.
  - "scripts/**/*.sh"
  - "src/**/*.ts"
exclude:             # Optional.
  - "node_modules/**"
  - "**/test/**"
```

Patterns SHALL use standard glob syntax with `**` for recursive matching.

### CS-004: Output Configuration

```yaml
output:
  directory: string  # Optional. Default: "_generated-docs"
```

### CS-005: Source Path Mappings

```yaml
sourcePathMappings:  # Optional. Maps variable names to directory paths.
  SCRIPTS_ROOT: "scripts/"
  LIB_DIR: "scripts/shared-tools/"
```

Keys are variable names (without `$`). Values are paths relative to project root.

### CS-006: Authored Content — Glossary

```yaml
authored:
  glossary:          # Optional. Key-value pairs.
    term: "definition"
```

Glossary terms SHALL be injected into generated documentation where the term appears or in a dedicated glossary section.

### CS-007: Authored Content — Module Narratives

```yaml
authored:
  moduleNarratives:  # Optional. Keyed by directory path.
    "scripts/heal/cycles":
      summary: string
      designDecisions: string
      howItWorks: string
```

Narratives SHALL be injected into the corresponding per-directory README.

### CS-008: Authored Content — Principles

```yaml
authored:
  principles:        # Optional. List of strings.
    - "Every script must be idempotent"
```

Principles SHALL appear in the ARCHITECTURE.md output.

### CS-009: Authored Content — Design Decisions

```yaml
authored:
  designDecisions:   # Optional. List of objects.
    - title: string
      rationale: string
```

Design decisions SHALL appear in the ARCHITECTURE.md output.

### CS-010: Authored Content — Behavioral Diagrams

```yaml
authored:
  diagrams:          # Optional. List of diagram objects.
    - id: string
      title: string
      placement: string    # Where to inject (e.g., "architecture-overview")
      mermaid: string      # Raw Mermaid syntax
```

Authored diagrams SHALL be injected at the specified placement location in generated output.

### CS-011: Configuration Validation

The tool SHALL validate the configuration at load time using TypeScript type checking. Invalid configuration SHALL produce a clear error message identifying the invalid field and expected type. No external JSON schema validator (e.g., ajv) is required.

---

## 6. Quality Requirements

#### QR-001: Accuracy — Zero False Claims

Every factual claim in generated documentation SHALL be verifiable from the filesystem. The tool SHALL NOT infer, guess, or hallucinate information. If information cannot be determined from static analysis, it SHALL be omitted (not approximated).

#### QR-002: Accuracy — Edge Correctness

Every edge in the dependency graph SHALL correspond to an actual relationship verifiable in source code (a `source` statement, a function call, an import statement). No synthetic or inferred edges.

#### QR-003: Accuracy — Entity Counts

All counts reported in generated documentation (number of scripts, functions, dependencies) SHALL be exact — derived from the graph data, not estimated or hardcoded.

#### QR-004: Completeness — Entity Coverage

The tool SHALL extract entities from 100% of files matching the include patterns that parse successfully. Files with syntax errors SHALL be logged as warnings but SHALL NOT prevent analysis of other files.

#### QR-005: Completeness — Edge Coverage

The tool SHALL resolve all cross-file edges where the source path is either:
- A literal string path, OR
- A variable path with a mapping in `sourcePathMappings`

Unresolvable edges SHALL be documented in the output (not silently dropped).

#### QR-006: Diagram Quality — Node Count Targets

Generated diagrams SHALL respect readability targets:
- L0 diagrams: 5-15 nodes
- L1 diagrams: 10-30 nodes
- L2 diagrams: 5-15 nodes

If a group exceeds the target, the tool SHALL filter to the highest-importance nodes.

#### QR-007: Diagram Quality — Edge Density

Generated diagrams SHALL maintain edge count < 2x node count for readability. Filtering priority:
1. Transitive reduction (always for L0)
2. Keep all inter-group edges
3. Within groups, keep edges involving high-degree nodes

#### QR-008: Staleness Prevention

Generated documentation SHALL include a generation timestamp and tool version. Re-running the tool on unchanged source files SHALL produce identical output (determinism enables staleness detection via diff).

#### QR-009: Graceful Degradation

If a file fails to parse, the tool SHALL:
- Log a warning identifying the file and error
- Continue processing all other files
- Mark the failed file in the output as "parse-failed"
- NOT crash or produce partial/corrupt output

---

## 7. Constraints

#### CON-001: No LLM API Calls

The tool SHALL NOT make any network requests to LLM services. All processing is local and deterministic. This is a hard constraint that cannot be violated under any circumstances.

#### CON-002: No graphology in Phase 1

Phase 1 SHALL NOT depend on graphology or any external graph library. Graph algorithms (SCC, transitive reduction, degree counting, longest-path) SHALL be implemented as custom code (~250 lines total).

#### CON-003: web-tree-sitter WASM Only

Shell parsing SHALL use the WASM variant of tree-sitter (web-tree-sitter), NOT native bindings. This ensures portability without requiring platform-specific compilation.

#### CON-004: TypeScript Implementation Language

The tool SHALL be implemented in TypeScript. This is justified by: ts-morph availability, unified ecosystem with web-tree-sitter, type safety, and target audience familiarity.

#### CON-005: analysis.json as Architectural Boundary

The `analysis.json` intermediate format is the contract between analysis and rendering. Phase 1 SHALL produce `analysis.json` FIRST, then render from it. Analysis and rendering SHALL be independently executable (the renderer reads only from `analysis.json` + config).

#### CON-006: Strategy Pattern, Not Plugin System

Language selection SHALL use a simple strategy pattern (switch on file extension). No plugin registry, no dynamic loading, no configuration-driven plugin discovery. A plugin interface MAY be extracted later after 3+ analyzers exist.

#### CON-007: No Incremental Processing

The tool SHALL perform full rebuilds on every run. No caching, no partial graph updates, no file-change detection. Full rebuild is acceptable for codebases under 500 files (completes in <5 seconds).

#### CON-008: Accuracy Over Completeness

When the tool cannot determine information with certainty from static analysis, it SHALL omit that information rather than guess. Known unresolvable patterns:
- `eval` statements
- Variable-as-command (`$cmd arg1 arg2`)
- Dynamic script invocation with computed paths
- Functions defined inside conditionals
- Runtime branch selection

#### CON-009: No Watch Mode or IDE Integration

The tool is a CLI-only batch processor. No file watchers, no language server protocol, no IDE extensions.

#### CON-010: Output Format — Markdown + Mermaid Only

The tool SHALL produce only Markdown files with embedded Mermaid diagrams. No HTML, no PDF, no other output formats. Mermaid is chosen because it renders natively on GitHub and GitLab without additional tooling.

#### CON-011: Node.js 18+ Required

The tool requires Node.js version 18 or higher. This is acceptable because the target users (toolkit developers) already have Node.js installed.

#### CON-012: Custom Rendering Functions Only

Documentation rendering SHALL use custom TypeScript functions (pure functions: data in, string out). No template engines (Handlebars, EJS, Mustache, etc.) SHALL be used. This ensures type safety, testability, and eliminates whitespace surprises.

---

## 8. Traceability Matrix

| Requirement | Architecture Section | Phase |
|-------------|---------------------|-------|
| FR-001 to FR-005 | Section 4 (Language Analysis) | 1 |
| FR-006 to FR-010 | Section 6 (Graph Algorithms) | 1 |
| FR-011 to FR-012 | Section 6 (Grouping, Conventions) | 1 |
| FR-013 | Section 9 (Data Model) | 1 |
| FR-014 to FR-019 | Section 7 (Rendering) | 1 |
| FR-020 | Section 11 (Implementation Plan) | 1 |
| FR-021 to FR-024 | Section 4 (TypeScript Analyzer) | 2 |
| FR-025 to FR-027 | Section 6 (Phase 3 Algorithms) | 3 |
| NFR-001 | Core Constraints | All |
| NFR-002 to NFR-006 | Section 6 (Performance Budget) | 1-2 |
| NFR-007 to NFR-011 | Section 3 (Language Choice) | 1 |
| NFR-012 | Section 4 (WASM Memory) | 1 |
| NFR-013 | Section 7 (Rendering Strategy) | 1 |
| CS-001 to CS-011 | Section 10 (Configuration) | 1 |
| QR-001 to QR-009 | Section 12 (Known Limitations) | 1 |
| CON-001 to CON-012 | Sections 1, 6, 11, 14 | All |

---

## 9. Acceptance Criteria Summary

The tool is considered complete for Phase 1 when:

1. It produces output at least as accurate as the current `lib-docgen.sh`
2. Mermaid diagrams are generated from actual graph data (not hardcoded)
3. Full pipeline runs in < 5 seconds on ~230 files
4. Zero false claims exist in generated documentation
5. `.docgen.yml` handles all project-specific content (no hardcoded values)
6. `analysis.json` is produced as an inspectable intermediate artifact
7. All shell scripts matching include patterns are analyzed (graceful degradation for parse failures)
8. The tool runs offline with no network requests
