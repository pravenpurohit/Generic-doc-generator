# Documentation Generator (`docgen`) — Implementation Tasks

Phase 1 MVP: Shell analysis + Graph + Mermaid + Markdown

---

## 1. Project Setup

**Description**: Initialize the package with build tooling, TypeScript config, and directory structure.

**Estimated lines**: ~80 (config files)

**Depends on**: Nothing (foundation task)

**Deliverables**:
- `tools/docgen/package.json` with dependencies: web-tree-sitter, tree-sitter-bash (WASM), yaml; devDeps: typescript, esbuild, vitest
- `tools/docgen/tsconfig.json` targeting ES2022, Node18, strict mode
- `tools/docgen/esbuild.config.ts` bundling to `dist/docgen.js`
- `tools/docgen/src/` directory skeleton (empty index files for each module)
- `tools/docgen/wasm/` directory with vendored `tree-sitter-bash.wasm`

**Verification**:
- `npm install` completes without errors
- `npx tsc --noEmit` passes on the skeleton
- `npm run build` produces `dist/docgen.js`

---

## 2. Types and Interfaces

**Description**: Define the shared data model used across all layers. These types form the contract between analyzers, engine, and renderer.

**Estimated lines**: ~180

**Depends on**: Task 1 (project setup)

**Deliverables**:
- `src/types.ts` — All interfaces: AnalysisOutput, FileEntry, Entity, EntityKind, Edge, EdgeKind, Group, Layer, Convention, Parameter, EnvVarUsage, ConfigReference
- `src/analyzers/interface.ts` — LanguageAnalyzer interface, DocFragment type, RawEdge type, ParseResult type

**Verification**:
- `npx tsc --noEmit` passes with no errors
- All types referenced in design document Section 2 are present
- Types are importable from other modules without circular dependencies

---

## 3. Configuration Loading

**Description**: Implement YAML parsing, validation, and config resolution. The config loader finds `.docgen.yml`, parses it, validates required fields, and returns a typed DocgenConfig object.

**Estimated lines**: ~150

**Depends on**: Task 2 (types)

**Deliverables**:
- `src/config.ts` — DocgenConfig interface, AuthoredContent interface, loadConfig() function, validateAuthoredContent(), config file resolution (CLI flag, then .docgen.yml, then .docgen.yaml)
- Custom ConfigError class with field-level error messages

**Verification**:
- Unit test: valid YAML parses to correct typed object
- Unit test: missing `project.name` throws ConfigError with field name
- Unit test: missing `include` array throws ConfigError
- Unit test: invalid `authored.diagrams` entry (missing fields) throws with path
- Unit test: file resolution order (--config flag > .docgen.yml > .docgen.yaml)

---

## 4. Shell Analyzer — Tree-Sitter WASM Initialization

**Description**: Set up the web-tree-sitter parser with the bash WASM grammar. Implement singleton initialization, parser reuse across files, and proper tree cleanup.

**Estimated lines**: ~60

**Depends on**: Task 1 (project setup — WASM binary vendored)

**Deliverables**:
- `src/analyzers/shell/parser.ts` — getParser() singleton, initParser(), parseFile() that returns a Tree, and a cleanup helper that calls tree.delete()
- WASM binary path resolution relative to the bundle

**Verification**:
- Unit test: getParser() returns a valid Parser instance
- Unit test: calling getParser() twice returns the same instance (singleton)
- Unit test: parseFile() on a simple shell script returns a tree with a "program" root node
- Unit test: tree.delete() does not throw after extraction
- Performance: initialization completes in < 500ms

---

## 5. Shell Analyzer — Function Extraction

**Description**: Walk the CST to extract function definitions, including name, location, positional parameters ($1, $2, etc.), and leading comment blocks as descriptions.

**Estimated lines**: ~120

**Depends on**: Task 4 (parser), Task 2 (Entity type)

**Deliverables**:
- `src/analyzers/shell/functions.ts` — extractFunctions(tree, filePath): Entity[], extractPositionalParams(bodyNode): Parameter[], extractLeadingComment(node): string | undefined
- CST traversal helper: visitNodes(cursor, nodeType, callback)

**Verification**:
- Unit test: extracts function name and line numbers from `function foo() { ... }`
- Unit test: extracts function from `bar() { ... }` (no `function` keyword)
- Unit test: detects $1, $2 usage as parameters
- Unit test: detects ${1} expansion form
- Unit test: extracts leading comment block as description
- Unit test: handles file with zero functions (returns empty array)
- Unit test: handles file with 20+ functions (returns all)

---

## 6. Shell Analyzer — Source Chain Extraction

**Description**: Extract `source` and `.` (dot) include statements from the CST. Produce raw edges with unresolved paths for later resolution.

**Estimated lines**: ~80

**Depends on**: Task 4 (parser), Task 2 (RawEdge type)

**Deliverables**:
- `src/analyzers/shell/source-chains.ts` — extractSourceEdges(tree, filePath): RawEdge[], stripQuotes() helper
- Handles: `source "path"`, `. "path"`, `source $VAR/path`, source with no quotes

**Verification**:
- Unit test: extracts `source "scripts/lib.sh"` as a literal path edge
- Unit test: extracts `. ./helpers.sh` (dot-include form)
- Unit test: extracts `source "$SCRIPTS_ROOT/lib.sh"` with variable intact
- Unit test: handles multiple source statements in one file
- Unit test: ignores commented-out source lines
- Unit test: returns empty array for files with no source statements

---

## 7. Shell Analyzer — Env Var Tracking + Entry Point Detection

**Description**: Extract environment variable usage (read, write, read-with-default) from function bodies and script-level code. Detect entry point scripts via shebang + executable permission or config listing.

**Estimated lines**: ~100

**Depends on**: Task 4 (parser), Task 2 (EnvVarUsage type)

**Deliverables**:
- `src/analyzers/shell/env-vars.ts` — extractEnvVarUsage(node): EnvVarUsage[], deduplicateUsages()
- `src/analyzers/shell/entry-points.ts` — detectEntryPoint(source, filePath, config): boolean, checkExecutablePermission(filePath): boolean

**Verification**:
- Unit test: detects `$VAR` as read mode
- Unit test: detects `${VAR}` as read mode
- Unit test: detects `${VAR:-default}` as read-with-default with correct defaultValue
- Unit test: detects `VAR=value` as write mode
- Unit test: detects `export VAR=value` as write mode
- Unit test: filters out positional params ($1, $@, $*) from env var results
- Unit test: deduplicates repeated references to same variable
- Unit test: detects `#!/bin/bash` shebang as entry point indicator
- Unit test: detects `#!/usr/bin/env bash` shebang
- Unit test: config-listed file is detected as entry point regardless of shebang

---

## 8. Source Path Resolution

**Description**: Resolve raw source paths (from Task 6) into actual file paths using sourcePathMappings from config, relative path resolution, and heuristic filename matching.

**Estimated lines**: ~110

**Depends on**: Task 6 (raw edges), Task 3 (config with sourcePathMappings)

**Deliverables**:
- `src/analyzers/shell/path-resolver.ts` — resolveSourcePath(rawPath, currentFile, mappings, allFiles): ResolvedPath
- Resolution steps: literal path, variable substitution, heuristic filename match, unresolved fallback
- ResolvedPath type with confidence levels: exact, mapped, heuristic, unresolved

**Verification**:
- Unit test: literal relative path resolves with confidence "exact"
- Unit test: `$SCRIPTS_ROOT/lib.sh` resolves via mapping with confidence "mapped"
- Unit test: `${LIB_DIR}/helpers.sh` resolves via mapping (curly brace form)
- Unit test: path with unmapped variable returns confidence "unresolved"
- Unit test: heuristic matches unique filename when variable prefix is unresolvable
- Unit test: heuristic returns unresolved when multiple candidates exist
- Unit test: surrounding quotes are stripped before resolution

---

## 9. Graph Construction

**Description**: Build the directed graph data structure (custom adjacency list) from entities and resolved edges. Compute forward and reverse adjacency maps.

**Estimated lines**: ~90

**Depends on**: Task 2 (types), Tasks 5-8 (entities and edges from analyzer)

**Deliverables**:
- `src/engine/graph.ts` — Graph interface, GraphNode interface, EdgeData interface, buildGraph(entities, resolvedEdges): Graph
- Forward adjacency map (outgoing edges per node)
- Reverse adjacency map (incoming edges per node)
- Edge map keyed by "source->target" string

**Verification**:
- Unit test: empty input produces empty graph
- Unit test: 3 nodes with 2 edges produces correct adjacency
- Unit test: reverse adjacency correctly reflects incoming edges
- Unit test: duplicate edges are merged (weight incremented)
- Unit test: self-loops are handled (node pointing to itself)
- Unit test: graph with isolated nodes (no edges) is valid

---

## 10. Graph Algorithms

**Description**: Implement the four core algorithms on the graph: Tarjan SCC, transitive reduction, degree-based importance, and longest-path layering. Also includes topological sort as a shared utility.

### 10.1 Tarjan SCC

**Estimated lines**: ~70

**Depends on**: Task 9 (graph structure)

**Deliverables**:
- `src/engine/scc.ts` — tarjanSCC(graph): string[][], condenseSCC(graph, sccs): Graph

**Verification**:
- Unit test: DAG with no cycles returns all single-node SCCs
- Unit test: simple 2-node cycle (A->B->A) returns one SCC with both nodes
- Unit test: complex graph with multiple SCCs identifies all correctly
- Unit test: condensation merges SCC nodes and redirects edges
- Unit test: condensed graph is a valid DAG (no cycles)

### 10.2 Transitive Reduction

**Estimated lines**: ~50

**Depends on**: Task 10.1 (condensed DAG), topological sort

**Deliverables**:
- `src/engine/transitive.ts` — computeTransitiveReduction(graph): void (mutates edge.inTransitiveReduction), topologicalSort(graph): string[], collectReachable() helper

**Verification**:
- Unit test: A->B->C with redundant A->C marks A->C as NOT in transitive reduction
- Unit test: diamond graph (A->B, A->C, B->D, C->D) keeps all 4 edges (none redundant)
- Unit test: linear chain (A->B->C->D) keeps all edges
- Unit test: all original edges remain in the graph (only boolean flag changes)
- Unit test: topologicalSort produces valid ordering (every edge goes forward)

### 10.3 Degree-Based Importance

**Estimated lines**: ~25

**Depends on**: Task 9 (graph with adjacency maps)

**Deliverables**:
- `src/engine/importance.ts` — computeDegreeImportance(graph): void (mutates entity.fanIn, entity.fanOut, entity.importance)

**Verification**:
- Unit test: isolated node has importance 0
- Unit test: node with 3 incoming and 2 outgoing has importance 5
- Unit test: hub node (high fan-in) scores higher than leaf node
- Unit test: all nodes in graph get importance assigned

### 10.4 Longest-Path Layering

**Estimated lines**: ~55

**Depends on**: Task 10.1 (condensed DAG), topological sort

**Deliverables**:
- `src/engine/layering.ts` — assignLayers(graph): Map<string, number>, assignLayerLabels(layers, entities): Layer[]

**Verification**:
- Unit test: leaf nodes (no outgoing edges) are assigned layer 0
- Unit test: node pointing only to leaves is assigned layer 1
- Unit test: longest path of 4 produces layers 0-3
- Unit test: layer labels assigned correctly (layer 0 = "utilities", highest = "orchestration")
- Unit test: disconnected components each get independent layering

---

## 11. Directory-Structure Grouping

**Description**: Group entities by their containing directory path. Compute internal and external edge counts for each group.

**Estimated lines**: ~60

**Depends on**: Task 9 (graph), Task 2 (Group type)

**Deliverables**:
- `src/engine/grouping.ts` — buildGroups(entities, edges): Group[]
- Each group: id (directory path), label (basename), entity list, internalEdgeCount, externalEdgeCount

**Verification**:
- Unit test: entities in same directory are grouped together
- Unit test: entities in different directories form separate groups
- Unit test: internalEdgeCount counts edges where both endpoints are in the group
- Unit test: externalEdgeCount counts edges crossing the group boundary
- Unit test: group label is the directory basename
- Unit test: empty directory (no entities) does not produce a group

---

## 12. Convention Detection

**Description**: Detect naming conventions and directory roles from filename patterns. Uses built-in rules (hook-*, lib-*, heal-*, etc.) with minimum match thresholds.

**Estimated lines**: ~80

**Depends on**: Task 2 (Convention type, FileEntry type)

**Deliverables**:
- `src/engine/conventions.ts` — detectConventions(files): Convention[], BUILTIN_RULES array, inferDirectoryRoles(files, groups): DirectoryRole[]

**Verification**:
- Unit test: 3 files matching `hook-*.sh` produces a convention with role "lifecycle hook"
- Unit test: 1 file matching `hook-*.sh` does NOT produce a convention (below minMatches of 2)
- Unit test: examples array contains up to 3 file paths
- Unit test: directory with >50% hook files gets role "hook directory"
- Unit test: directory with >50% lib files gets role "shared library directory"
- Unit test: multiple conventions can be detected simultaneously

---

## 13. analysis.json Serialization

**Description**: Assemble the full AnalysisOutput object and serialize it to deterministic JSON. Implements stable key ordering and atomic file writes.

**Estimated lines**: ~70

**Depends on**: Tasks 9-12 (all engine outputs), Task 2 (AnalysisOutput type)

**Deliverables**:
- `src/engine/serialize.ts` — buildAnalysisOutput(meta, files, entities, edges, groups, layers, conventions): AnalysisOutput, writeAnalysisJson(output, outputDir): void
- Deterministic serialization: sorted keys, stable entity/edge ordering
- Atomic write: write to .tmp file, then rename

**Verification**:
- Unit test: same input produces byte-identical JSON output (determinism)
- Unit test: output matches AnalysisOutput schema (all required fields present)
- Unit test: meta section includes version, timestamp, rootDir, config reference
- Unit test: entities are sorted by id for stable output
- Unit test: edges are sorted by source then target for stable output
- Integration test: file is written atomically (no partial writes on error)

---

## 14. Mermaid Diagram Generation

**Description**: Generate multi-level Mermaid flowchart diagrams from graph data. Implements L0 (system overview) and L1 (module detail) diagrams with edge density control and ID sanitization.

### 14.1 Mermaid Utilities

**Estimated lines**: ~40

**Depends on**: Task 2 (types)

**Deliverables**:
- `src/renderer/mermaid/sanitize.ts` — sanitizeId(id): string, enforceEdgeDensity(nodes, edges, maxRatio): Edge[]

**Verification**:
- Unit test: file paths with slashes and dots are converted to valid Mermaid IDs
- Unit test: special characters (colons, hashes) are replaced with underscores
- Unit test: enforceEdgeDensity keeps all edges when under budget
- Unit test: enforceEdgeDensity trims to maxRatio * nodeCount when over budget
- Unit test: trimming preserves inter-group edges over intra-group edges

### 14.2 L0 System Overview Diagram

**Estimated lines**: ~70

**Depends on**: Task 14.1 (utilities), Task 11 (groups), Task 10.2 (transitive reduction)

**Deliverables**:
- `src/renderer/mermaid/l0-overview.ts` — renderL0Diagram(groups, edges, entities): string
- Groups become nodes with entity count labels
- Inter-group edges filtered by transitive reduction
- Node merging when > 15 groups (low-importance groups merged into "other")

**Verification**:
- Unit test: produces valid Mermaid flowchart TD syntax
- Unit test: each group appears as a labeled node
- Unit test: only edges with inTransitiveReduction=true appear
- Unit test: output has <= 15 nodes (merging applied when needed)
- Unit test: edge density stays below 2x node count
- Unit test: output is enclosed in triple-backtick mermaid fence

### 14.3 L1 Module Detail Diagram

**Estimated lines**: ~60

**Depends on**: Task 14.1 (utilities), Task 11 (groups)

**Deliverables**:
- `src/renderer/mermaid/l1-module.ts` — renderL1Diagram(group, entities, edges): string
- Functions within a single group as nodes
- Intra-group edges shown; entry points get rounded shape
- Top-30 by importance if group exceeds 30 entities

**Verification**:
- Unit test: produces valid Mermaid flowchart TD syntax
- Unit test: only entities belonging to the target group appear
- Unit test: entry point entities use rounded node shape `([ ])`
- Unit test: source edges use dashed arrow style `-.->` 
- Unit test: groups with > 30 entities are trimmed to top-30 by importance
- Unit test: edge density stays below 2x node count

---

## 15. Markdown Renderers

**Description**: Implement the three core Markdown renderers as pure functions: data in, string out. Each reads from AnalysisOutput + config and produces a complete Markdown document.

### 15.1 ARCHITECTURE.md Renderer

**Estimated lines**: ~80

**Depends on**: Task 14.2 (L0 diagram), Task 3 (config with authored content)

**Deliverables**:
- `src/renderer/architecture.ts` — renderArchitectureOverview(ctx: RenderContext): RenderedFile
- Sections: project name/description, L0 diagram, layer descriptions, authored principles, authored design decisions, authored behavioral diagrams

**Verification**:
- Unit test: output starts with `# <project name>` heading
- Unit test: L0 Mermaid diagram is embedded in the output
- Unit test: each layer is listed with its groups and entity counts
- Unit test: authored principles appear under "## Principles" heading
- Unit test: authored design decisions appear with title and rationale
- Unit test: authored diagrams are injected at correct placement
- Unit test: missing optional authored content does not cause errors

### 15.2 Per-Directory README Renderer

**Estimated lines**: ~90

**Depends on**: Task 14.3 (L1 diagram), Task 12 (conventions), Task 3 (config narratives)

**Deliverables**:
- `src/renderer/directory-readme.ts` — renderDirectoryReadmes(ctx: RenderContext): RenderedFile[]
- Sections per directory: title, convention-based role, authored narrative, L1 diagram, entity table (name, kind, importance, description)

**Verification**:
- Unit test: produces one RenderedFile per group
- Unit test: output path is `<group-id>/README.md`
- Unit test: convention role appears as "**Role**: ..." line
- Unit test: authored moduleNarrative is injected when present
- Unit test: L1 diagram is embedded
- Unit test: entity table is sorted by importance descending
- Unit test: groups with no entities still produce a minimal README

### 15.3 SCRIPTS-CATALOG.md Renderer

**Estimated lines**: ~60

**Depends on**: Task 11 (groups), Task 2 (Entity type)

**Deliverables**:
- `src/renderer/script-catalog.ts` — renderScriptCatalog(ctx: RenderContext): RenderedFile
- Flat searchable index: scripts grouped by directory, table with name, entry point status, dependency count, description

**Verification**:
- Unit test: output starts with `# Scripts Catalog` heading
- Unit test: total script count is accurate
- Unit test: scripts are grouped by directory with `## <dir>` headings
- Unit test: entry point column shows "Yes" or "No" correctly
- Unit test: dependency count matches entity fanOut value
- Unit test: script name links to the file path

### 15.4 Cross-Reference Index Renderer

**Estimated lines**: ~60

**Depends on**: Task 9 (graph edges), Task 2 (Entity type)

**Deliverables**:
- `src/renderer/cross-reference.ts` — renderCrossReferenceIndex(ctx: RenderContext): RenderedFile
- Entities sorted by importance, showing callers and callees for each

**Verification**:
- Unit test: entities are sorted by importance (highest first)
- Unit test: only entities with importance > 0 are listed
- Unit test: "Called by" lists all source entities of incoming edges
- Unit test: "Calls" lists all target entities of outgoing edges
- Unit test: entity file path and kind are shown

---

## 16. CLI Entry Point

**Description**: Implement the CLI argument parser and pipeline orchestrator. Wires together config loading, file discovery, analysis, serialization, and rendering.

**Estimated lines**: ~150

**Depends on**: All previous tasks (this is the integration layer)

**Deliverables**:
- `src/index.ts` — main() async function, parseArgs(), command dispatch
- Commands: `generate`, `generate --json-only`, `render`, `validate`
- Flags: --config, --output, --verbose, --quiet, --json-only
- Exit codes: 0 (success), 1 (config error), 2 (no files), 3 (output error), 4 (internal error)
- File discovery: apply include/exclude globs, build FileManifest[]
- Pipeline orchestration: discover files -> analyze -> build graph -> run algorithms -> serialize -> render
- Atomic output: write to temp dir, then rename on success

**Verification**:
- Unit test: parseArgs correctly extracts command and flags
- Unit test: `validate` command loads config and exits 0 on valid config
- Unit test: `validate` command exits 1 on invalid config with error message
- Integration test: `generate` on fixture project produces analysis.json + markdown files
- Integration test: `generate --json-only` produces only analysis.json
- Integration test: `render` reads existing analysis.json and produces markdown
- Integration test: exit code 2 when include patterns match zero files
- Integration test: verbose mode prints timing and file counts to stdout
- Integration test: quiet mode produces no stdout output

---

## 17. Integration Testing

**Description**: End-to-end tests that run the full pipeline on fixture shell scripts and verify the complete output chain: analysis.json correctness, Mermaid diagram validity, and Markdown structure.

**Estimated lines**: ~200 (test code + fixtures)

**Depends on**: All previous tasks

**Deliverables**:
- `test/fixtures/sample-scripts/` — 10-15 shell scripts with known structure (functions, source chains, env vars, entry points, naming conventions)
- `test/fixtures/.docgen.yml` — config for the fixture project with sourcePathMappings and authored content
- `test/fixtures/expected-output/` — expected analysis.json snapshot and key markdown sections
- `test/integration/pipeline.test.ts` — full pipeline integration tests
- `test/integration/shell-analyzer.test.ts` — analyzer-level integration tests

**Verification**:
- Integration test: full pipeline on fixtures produces analysis.json matching expected snapshot
- Integration test: entity count in analysis.json matches actual function count in fixtures
- Integration test: edge count matches actual source statements in fixtures
- Integration test: L0 diagram contains all expected group nodes
- Integration test: L1 diagram for a specific group contains expected function nodes
- Integration test: ARCHITECTURE.md contains project name from config
- Integration test: SCRIPTS-CATALOG.md lists all entry point scripts
- Integration test: per-directory READMEs exist for each group
- Integration test: unresolvable source paths produce warnings on stderr
- Integration test: parse-failed files are logged but do not crash the pipeline
- Performance test: full pipeline on fixtures completes in < 5 seconds
- Determinism test: running pipeline twice produces identical output

---

## Summary

| Task | Estimated Lines | Cumulative |
|------|----------------|-----------|
| 1. Project Setup | 80 | 80 |
| 2. Types and Interfaces | 180 | 260 |
| 3. Configuration Loading | 150 | 410 |
| 4. Shell Analyzer — WASM Init | 60 | 470 |
| 5. Shell Analyzer — Functions | 120 | 590 |
| 6. Shell Analyzer — Source Chains | 80 | 670 |
| 7. Shell Analyzer — Env Vars + Entry Points | 100 | 770 |
| 8. Source Path Resolution | 110 | 880 |
| 9. Graph Construction | 90 | 970 |
| 10. Graph Algorithms (SCC + TR + Importance + Layering) | 200 | 1170 |
| 11. Directory-Structure Grouping | 60 | 1230 |
| 12. Convention Detection | 80 | 1310 |
| 13. analysis.json Serialization | 70 | 1380 |
| 14. Mermaid Diagram Generation (L0, L1) | 170 | 1550 |
| 15. Markdown Renderers | 290 | 1840 |
| 16. CLI Entry Point | 150 | 1990 |
| 17. Integration Testing | 200 | 2190 |

**Total estimated implementation**: ~2,190 lines of TypeScript (source + tests)
