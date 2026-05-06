# Documentation Generator (`docgen`) — Technical Design

## 1. System Architecture

### 3-Layer Pipeline Design

The docgen tool uses a strict 3-layer pipeline architecture where data flows in one direction: extraction, processing, rendering. Each layer has a single responsibility and communicates through well-defined data contracts.

```
+------------------------------------------------------------------+
|                        LAYER 1: ANALYZERS                         |
|                   (Language-specific extraction)                   |
+----------------------------------+-------------------------------+
|  Shell Analyzer                  |  TypeScript Analyzer (Phase 2) |
|  - web-tree-sitter (WASM)        |  - ts-morph                    |
|  - Function extractor            |  - Function/class extractor    |
|  - Source-chain resolver         |  - Import graph builder        |
|  - Env var tracker               |  - Call hierarchy extractor    |
|  - Entry point detector          |  - Type relationship mapper    |
+-----------------+----------------+---------------+---------------+
                  |                                 |
                  v                                 v
+------------------------------------------------------------------+
|                     LAYER 2: ENGINE                                |
|              (Language-agnostic graph processing)                  |
+------------------------------------------------------------------+
|  - Unified graph construction (custom adjacency list)             |
|  - SCC condensation (Tarjan)                                      |
|  - Transitive reduction (diagram generation ONLY)                 |
|  - Degree-based importance (fan-in / fan-out)                     |
|  - Longest-path layering                                          |
|  - Directory-structure-based grouping                             |
|  - Convention detection (naming patterns, directory structure)     |
+----------------------------------+-------------------------------+
                                   |
                                   v
+------------------------------------------------------------------+
|                     LAYER 3: RENDERER                              |
|              (Markdown + Mermaid generation)                       |
+------------------------------------------------------------------+
|  - Architecture overview renderer                                 |
|  - Per-module/directory README renderer                            |
|  - Script catalog renderer                                        |
|  - Mermaid diagram generator (multi-level: L0, L1, L2)            |
|  - Cross-reference index renderer                                 |
|  - Config-driven authored content injector                        |
+------------------------------------------------------------------+
```

### Component Descriptions

**Layer 1 — Analyzers** are language-specific extractors. Each analyzer implements the `LanguageAnalyzer` interface and produces `DocFragment[]` from source files. Language selection uses a strategy pattern (switch on file extension). Phase 1 ships only the Shell Analyzer; the TypeScript Analyzer arrives in Phase 2.

**Layer 2 — Engine** is entirely language-agnostic. It receives `DocFragment[]` from any analyzer, constructs a unified directed graph, runs the algorithm stack (SCC, transitive reduction, degree importance, longest-path layering), assigns groups and conventions, and serializes the result to `analysis.json`. This layer owns the graph data structure and all algorithms.

**Layer 3 — Renderer** reads `analysis.json` plus `.docgen.yml` authored content and produces Markdown files with embedded Mermaid diagrams. It has zero knowledge of source languages or parsing. Rendering is implemented as pure TypeScript functions — no template engines.

### Architectural Boundary: analysis.json

The `analysis.json` file is the contract between analysis (Layers 1+2) and rendering (Layer 3). This boundary enables:

- Independent iteration on analysis vs. rendering
- Caching: skip re-analysis if source files have not changed
- Inspection: developers can examine the intermediate format directly
- Testing: renderers can be tested against fixture JSON without running analysis
- Diffing: deterministic JSON output enables meaningful diffs

Phase 1 produces `analysis.json` FIRST, then renders from it. The CLI supports `--json-only` to produce only the intermediate format.

---

## 2. Data Model

### Full TypeScript Interfaces for analysis.json

```typescript
/**
 * Top-level output structure written to analysis.json.
 * This is the architectural boundary between analysis and rendering.
 */
interface AnalysisOutput {
  meta: {
    version: string;          // Tool version (semver)
    generatedAt: string;      // ISO 8601 timestamp
    rootDir: string;          // Absolute path to analyzed project root
    config: ConfigReference;  // Reference to config file used
  };

  files: FileEntry[];         // All discovered and analyzed files
  entities: Entity[];         // All extracted code entities
  edges: Edge[];              // All relationships between entities
  groups: Group[];            // Directory-based groupings
  layers: Layer[];            // Architectural layer assignments
  conventions: Convention[];  // Detected naming/structural patterns
}

interface ConfigReference {
  path: string;               // Relative path to .docgen.yml
  hash: string;               // SHA-256 of config file (for cache invalidation)
}

/**
 * Represents a single discovered source file.
 */
interface FileEntry {
  path: string;               // Relative path from project root
  language: "shell" | "typescript" | "json" | "yaml" | "markdown";
  size: number;               // File size in bytes
  mtime: string;              // ISO 8601 last-modified timestamp
  isEntryPoint: boolean;      // Has shebang + executable, or listed in config
  group: string;              // Group ID (directory path)
  layer: number;              // Assigned architectural layer
}

/**
 * A code entity extracted from source: function, class, script, etc.
 */
interface Entity {
  id: string;                 // Unique identifier: "file:<path>#<name>"
  kind: EntityKind;
  name: string;               // Human-readable name
  filePath: string;           // File this entity belongs to
  location: {
    startLine: number;
    endLine: number;
  };
  signature?: string;         // Function signature or declaration
  description?: string;       // Extracted from comments or JSDoc
  parameters?: Parameter[];   // Function parameters
  returnType?: string;        // Return type (TypeScript only)
  envVars?: EnvVarUsage[];    // Environment variables used (shell)
  exitCodes?: number[];       // Exit codes used (shell scripts)
  fanIn: number;              // Count of incoming edges
  fanOut: number;             // Count of outgoing edges
  importance: number;         // Degree-based score: fanIn + fanOut
  layer: number;              // Architectural layer assignment
  group: string;              // Group ID this entity belongs to
}

type EntityKind =
  | "function"
  | "class"
  | "interface"
  | "script"
  | "module"
  | "hook"
  | "configuration"
  | "entrypoint";

interface Parameter {
  name: string;               // "$1", "$2", or named parameter
  description?: string;       // From comments if available
  required: boolean;
}

interface EnvVarUsage {
  name: string;               // Variable name (without $)
  mode: "read" | "write" | "read-with-default";
  defaultValue?: string;      // For ${VAR:-default} patterns
}

/**
 * A directed edge between two entities.
 */
interface Edge {
  source: string;             // Source entity ID
  target: string;             // Target entity ID
  kind: EdgeKind;
  weight: number;             // Call frequency or coupling strength
  inTransitiveReduction: boolean; // Survives reduction (diagram filter ONLY)
}

type EdgeKind =
  | "calls"                   // Function calls another function
  | "imports"                 // Module imports another module
  | "sources"                 // Shell source/dot inclusion
  | "spawns"                  // Cross-language process execution
  | "extends"                 // Class inheritance
  | "implements";             // Interface implementation

/**
 * A logical grouping of entities (directory-based in MVP).
 */
interface Group {
  id: string;                 // Directory path as identifier
  label: string;              // Human-readable label (directory basename)
  entities: string[];         // Entity IDs belonging to this group
  internalEdgeCount: number;  // Edges between entities within this group
  externalEdgeCount: number;  // Edges crossing this group boundary
}

/**
 * An architectural layer derived from longest-path algorithm.
 * Layer 0 = infrastructure/utilities (leaves).
 * Higher layers = orchestration/entry points (roots).
 */
interface Layer {
  level: number;              // 0-based layer index
  label: string;              // Descriptive label (e.g., "utilities", "orchestration")
  groups: string[];           // Group IDs assigned to this layer
}

/**
 * A detected naming or structural convention.
 */
interface Convention {
  pattern: string;            // Glob or regex pattern (e.g., "hook-*.sh")
  role: string;               // Inferred role (e.g., "lifecycle hook")
  matchCount: number;         // Number of files matching this pattern
  examples: string[];         // Up to 3 example file paths
}
```

### Entity ID Format

Entity IDs follow the format `file:<relative-path>#<entity-name>`. For script-level entities (the script itself), the name is the filename without extension. Examples:

- `file:scripts/bootstrap.sh#bootstrap` — the script entity
- `file:scripts/bootstrap.sh#setup_env` — a function within the script
- `file:src/graph.ts#buildGraph` — a TypeScript function

This format ensures global uniqueness and enables reverse-lookup from ID to file location.

---

## 3. Shell Analyzer Design

### Overview

The Shell Analyzer uses web-tree-sitter with the tree-sitter-bash WASM grammar to parse shell scripts into a full concrete syntax tree (CST). From the CST, it extracts functions, source chains, environment variables, and entry point markers.

### WASM Initialization

```typescript
import Parser from "web-tree-sitter";

let parserInstance: Parser | null = null;

async function getParser(): Promise<Parser> {
  if (parserInstance) return parserInstance;
  await Parser.init();
  parserInstance = new Parser();
  const lang = await Parser.Language.load("tree-sitter-bash.wasm");
  parserInstance.setLanguage(lang);
  return parserInstance;
}
```

Key constraints:
- Budget 200-500ms for first initialization
- Reuse the parser instance across all files (no re-initialization)
- Call `tree.delete()` after extracting data from each file to prevent WASM memory leaks

### Function Extraction

The analyzer walks the CST looking for `function_definition` nodes:

```typescript
function extractFunctions(tree: Parser.Tree, filePath: string): Entity[] {
  const entities: Entity[] = [];
  const cursor = tree.walk();

  // Visit all function_definition nodes
  visitNodes(cursor, "function_definition", (node) => {
    const nameNode = node.childForFieldName("name");
    const bodyNode = node.childForFieldName("body");
    if (!nameNode || !bodyNode) return;

    const name = nameNode.text;
    const params = extractPositionalParams(bodyNode);
    const envVars = extractEnvVarUsage(bodyNode);

    entities.push({
      id: `file:${filePath}#${name}`,
      kind: "function",
      name,
      filePath,
      location: {
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      },
      parameters: params,
      envVars,
      fanIn: 0,   // computed later by engine
      fanOut: 0,
      importance: 0,
      layer: 0,
      group: path.dirname(filePath),
    });
  });

  return entities;
}
```

### Positional Parameter Detection

Shell functions use `$1`, `$2`, etc. The analyzer scans function bodies for these references:

```typescript
function extractPositionalParams(bodyNode: Parser.SyntaxNode): Parameter[] {
  const params: Parameter[] = [];
  const seen = new Set<string>();

  visitNodes(bodyNode.walk(), "simple_expansion", (node) => {
    const varName = node.text; // e.g., "$1"
    if (/^\$\d+$/.test(varName) && !seen.has(varName)) {
      seen.add(varName);
      params.push({ name: varName, required: true });
    }
  });

  // Also check ${N} expansions
  visitNodes(bodyNode.walk(), "expansion", (node) => {
    const varName = node.firstChild?.text;
    if (varName && /^\d+$/.test(varName) && !seen.has(`$${varName}`)) {
      seen.add(`$${varName}`);
      params.push({ name: `$${varName}`, required: true });
    }
  });

  return params.sort((a, b) => a.name.localeCompare(b.name));
}
```

### Source Chain Resolution

Source statements (`source "path"` or `. "path"`) create inter-file dependency edges. The analyzer extracts these by finding `command` nodes where the command name is `source` or `.`:

```typescript
function extractSourceEdges(tree: Parser.Tree, filePath: string): RawEdge[] {
  const edges: RawEdge[] = [];
  const cursor = tree.walk();

  visitNodes(cursor, "command", (node) => {
    const cmdName = node.childForFieldName("name")?.text;
    if (cmdName !== "source" && cmdName !== ".") return;

    const argNode = node.childForFieldName("argument")
      ?? node.children.find((c, i) => i > 0 && c.type !== "comment");
    if (!argNode) return;

    const rawPath = stripQuotes(argNode.text);
    edges.push({
      sourceFile: filePath,
      targetPath: rawPath,  // May contain variables, resolved later
      kind: "sources",
    });
  });

  return edges;
}
```

Variable-based paths (e.g., `"$SCRIPTS_ROOT/lib.sh"`) are resolved in a separate pass using the `sourcePathMappings` from configuration. See Section 9 for the full resolution algorithm.

### Environment Variable Tracking

The analyzer distinguishes three modes of environment variable usage:

1. **Read**: `$VAR` or `${VAR}` — simple expansion nodes
2. **Write**: `VAR=value` or `export VAR=value` — variable assignment nodes
3. **Read with default**: `${VAR:-default}` — expansion nodes with the `:-` operator

```typescript
function extractEnvVarUsage(node: Parser.SyntaxNode): EnvVarUsage[] {
  const usages: EnvVarUsage[] = [];

  // Reads: simple_expansion nodes like $VAR
  visitNodes(node.walk(), "simple_expansion", (n) => {
    const name = n.text.replace(/^\$/, "");
    if (!/^\d+$/.test(name) && name !== "@" && name !== "*") {
      usages.push({ name, mode: "read" });
    }
  });

  // Reads with defaults: expansion nodes with :- operator
  visitNodes(node.walk(), "expansion", (n) => {
    const text = n.text;
    if (text.includes(":-")) {
      const name = text.match(/\{(\w+):-/)?.[1];
      const defaultVal = text.match(/:-([^}]*)\}/)?.[1];
      if (name) {
        usages.push({ name, mode: "read-with-default", defaultValue: defaultVal });
      }
    }
  });

  // Writes: variable_assignment nodes
  visitNodes(node.walk(), "variable_assignment", (n) => {
    const name = n.childForFieldName("name")?.text;
    if (name) usages.push({ name, mode: "write" });
  });

  return deduplicateUsages(usages);
}
```

### Entry Point Detection

A file is an entry point if it has a shebang line AND executable permissions, or if it is explicitly listed in configuration:

```typescript
function detectEntryPoint(source: string, filePath: string, config: Config): boolean {
  const hasShebang = /^#!.*\b(bash|sh)\b/.test(source.split("\n")[0] ?? "");
  const isExecutable = checkExecutablePermission(filePath);
  const isConfigListed = config.entryPoints?.includes(filePath) ?? false;
  return (hasShebang && isExecutable) || isConfigListed;
}
```

---

## 4. Graph Algorithms

### Overview

The engine implements four graph algorithms in ~250 lines of custom TypeScript. No external graph library is used in Phase 1. The graph is represented as a custom adjacency list.

### Graph Data Structure

```typescript
interface Graph {
  nodes: Map<string, GraphNode>;
  adjacency: Map<string, Set<string>>;     // outgoing edges
  reverseAdj: Map<string, Set<string>>;    // incoming edges (for fan-in)
  edges: Map<string, EdgeData>;            // key: "source->target"
}

interface GraphNode {
  id: string;
  entity: Entity;
}

interface EdgeData {
  source: string;
  target: string;
  kind: EdgeKind;
  weight: number;
  inTransitiveReduction: boolean;
}
```

### Algorithm 1: Tarjan SCC (~60 lines)

Tarjan's algorithm finds strongly connected components — groups of nodes where every node is reachable from every other node. In shell scripts, this corresponds to mutual recursion (function A calls B, B calls A).

**Purpose**: Collapse SCCs into single composite nodes so the graph becomes a DAG, enabling topological operations.

**Expected behavior**: Likely a no-op for this codebase (shell scripts rarely have mutual recursion), but included for correctness.

```typescript
function tarjanSCC(graph: Graph): string[][] {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const sccs: string[][] = [];

  function strongconnect(v: string): void {
    indices.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    const neighbors = graph.adjacency.get(v) ?? new Set();
    for (const w of neighbors) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc);
    }
  }

  for (const nodeId of graph.nodes.keys()) {
    if (!indices.has(nodeId)) {
      strongconnect(nodeId);
    }
  }

  return sccs;
}
```

**Condensation**: After finding SCCs, multi-node components are collapsed into a single representative node. All edges into/out of the SCC are redirected to the representative. The condensed graph is guaranteed to be a DAG.

### Algorithm 2: Transitive Reduction (~40 lines)

Transitive reduction removes redundant edges: if A->B->C exists and A->C also exists, the direct A->C edge is redundant for reachability. Removing it simplifies diagrams without losing connectivity information.

**Critical constraint**: Transitive reduction is applied for diagram filtering ONLY. The `analysis.json` data model retains ALL edges. The `inTransitiveReduction` boolean marks which edges survive — used as a rendering filter, not a data transformation.

```typescript
function computeTransitiveReduction(graph: Graph): void {
  // Operates on the condensed DAG
  const topoOrder = topologicalSort(graph);

  for (const u of topoOrder) {
    const directSuccessors = new Set(graph.adjacency.get(u) ?? []);

    for (const v of directSuccessors) {
      // Check if v is reachable from u through another path
      const reachableFromOthers = new Set<string>();
      for (const w of directSuccessors) {
        if (w === v) continue;
        collectReachable(graph, w, reachableFromOthers);
      }

      const edgeKey = `${u}->${v}`;
      const edge = graph.edges.get(edgeKey);
      if (edge) {
        edge.inTransitiveReduction = !reachableFromOthers.has(v);
      }
    }
  }
}

function collectReachable(graph: Graph, start: string, visited: Set<string>): void {
  const queue = [start];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const neighbor of graph.adjacency.get(node) ?? []) {
      queue.push(neighbor);
    }
  }
}
```

**Performance**: O(V*E) worst case. For the target codebase (V=500, E=1500), this is ~750K operations — well under 50ms in Node.js.

### Algorithm 3: Degree-Based Importance (~20 lines)

The simplest importance metric: sum of incoming edges (fan-in) and outgoing edges (fan-out). High-degree nodes are architectural hubs.

```typescript
function computeDegreeImportance(graph: Graph): void {
  for (const [nodeId, node] of graph.nodes) {
    const fanIn = graph.reverseAdj.get(nodeId)?.size ?? 0;
    const fanOut = graph.adjacency.get(nodeId)?.size ?? 0;
    node.entity.fanIn = fanIn;
    node.entity.fanOut = fanOut;
    node.entity.importance = fanIn + fanOut;
  }
}
```

This metric is sufficient for graphs under 500 nodes. PageRank (Phase 3) would only be added if degree-based ranking produces poor diagram node selection.

### Algorithm 4: Longest-Path Layering (~50 lines)

Assigns architectural layers using the longest path from any leaf node. Leaf nodes (no outgoing edges) are layer 0 (infrastructure/utilities). Nodes with longer paths to leaves are higher layers (orchestration/entry points).

This implements the Sugiyama framework layer assignment step on the condensed DAG.

```typescript
function assignLayers(graph: Graph): Map<string, number> {
  const layers = new Map<string, number>();
  const topoOrder = topologicalSort(graph);

  // Initialize all nodes to layer 0
  for (const nodeId of graph.nodes.keys()) {
    layers.set(nodeId, 0);
  }

  // Process in topological order (leaves first)
  // Each node layer = max(layer of successors) + 1
  // Reverse topo order so we process from roots to leaves
  for (const u of topoOrder.reverse()) {
    const successors = graph.adjacency.get(u) ?? new Set();
    let maxSuccessorLayer = -1;
    for (const v of successors) {
      const vLayer = layers.get(v) ?? 0;
      if (vLayer > maxSuccessorLayer) {
        maxSuccessorLayer = vLayer;
      }
    }
    if (maxSuccessorLayer >= 0) {
      layers.set(u, maxSuccessorLayer + 1);
    }
    // Leaves remain at layer 0
  }

  return layers;
}

function topologicalSort(graph: Graph): string[] {
  const visited = new Set<string>();
  const result: string[] = [];

  function dfs(node: string): void {
    if (visited.has(node)) return;
    visited.add(node);
    for (const neighbor of graph.adjacency.get(node) ?? []) {
      dfs(neighbor);
    }
    result.push(node);
  }

  for (const nodeId of graph.nodes.keys()) {
    dfs(nodeId);
  }

  return result.reverse(); // Reverse post-order = topological order
}
```

**Layer label assignment**: After computing numeric layers, the engine assigns descriptive labels based on the layer position and the types of entities at that layer:
- Layer 0: "utilities" or "infrastructure"
- Middle layers: "domain" or "services"
- Highest layer: "orchestration" or "entry points"

### Performance Budget

For V=500 nodes, E=1500 edges:

| Algorithm | Complexity | Estimated Time |
|-----------|-----------|---------------|
| Tarjan SCC | O(V+E) | < 2ms |
| Transitive Reduction | O(V*E) | < 30ms |
| Degree Importance | O(V+E) | < 1ms |
| Longest-Path Layering | O(V+E) | < 2ms |
| **Total** | | **< 50ms** |

Memory usage: < 1 MB for the graph data structure at this scale.

---

## 5. Mermaid Diagram Generation

### Multi-Level Diagram Strategy

No single diagram can readably show 200+ nodes. The tool generates diagrams at three zoom levels, each serving a different documentation context:

| Level | Content | Target Nodes | Placement | Edge Filter |
|-------|---------|--------------|-----------|-------------|
| L0 | Directory groups as nodes, inter-group edges | 5-15 | ARCHITECTURE.md | Transitive reduction |
| L1 | Functions within one directory/group | 10-30 | Per-directory README | All intra-group edges |
| L2 | Specific call chain from entry to leaf | 5-15 | Feature docs | Path-based selection |

### L0: System Overview Diagram

The L0 diagram shows the highest-level architecture: each directory group becomes a single node, and edges represent inter-group dependencies.

```typescript
function renderL0Diagram(groups: Group[], edges: Edge[], entities: Entity[]): string {
  const lines: string[] = ["```mermaid", "flowchart TD"];

  // Each group becomes a node
  for (const group of groups) {
    const entityCount = group.entities.length;
    const label = `${group.label} (${entityCount})`;
    lines.push(`  ${sanitizeId(group.id)}["${label}"]`);
  }

  // Inter-group edges (transitive reduction applied)
  const groupEdges = computeInterGroupEdges(edges, entities);
  const reducedEdges = groupEdges.filter(e => e.inTransitiveReduction);

  for (const edge of reducedEdges) {
    const weight = edge.weight > 1 ? `|${edge.weight}|` : "";
    lines.push(`  ${sanitizeId(edge.source)} -->${weight} ${sanitizeId(edge.target)}`);
  }

  lines.push("```");
  return lines.join("\n");
}
```

**Node count control**: If more than 15 groups exist, merge low-importance groups (fewest entities, fewest external edges) into an "other" composite node.

### L1: Module Detail Diagram

The L1 diagram shows functions within a single directory and their internal relationships. Used in per-directory README files.

```typescript
function renderL1Diagram(group: Group, entities: Entity[], edges: Edge[]): string {
  const lines: string[] = ["```mermaid", "flowchart TD"];
  const groupEntities = entities.filter(e => group.entities.includes(e.id));

  // Node count control: if > 30 entities, keep only top-30 by importance
  const displayEntities = groupEntities.length > 30
    ? groupEntities.sort((a, b) => b.importance - a.importance).slice(0, 30)
    : groupEntities;

  const displayIds = new Set(displayEntities.map(e => e.id));

  // Emit nodes
  for (const entity of displayEntities) {
    const shape = entity.kind === "entrypoint" ? `([${entity.name}])` : `["${entity.name}"]`;
    lines.push(`  ${sanitizeId(entity.id)}${shape}`);
  }

  // Emit intra-group edges
  const intraEdges = edges.filter(
    e => displayIds.has(e.source) && displayIds.has(e.target)
  );
  for (const edge of intraEdges) {
    const style = edge.kind === "sources" ? "-.->" : "-->";
    lines.push(`  ${sanitizeId(edge.source)} ${style} ${sanitizeId(edge.target)}`);
  }

  lines.push("```");
  return lines.join("\n");
}
```

### L2: Flow Detail Diagram

The L2 diagram traces a specific call chain from an entry point to its leaf dependencies. Used for feature-level documentation.

```typescript
function renderL2Diagram(
  entryPointId: string,
  graph: Graph,
  maxDepth: number = 5
): string {
  const lines: string[] = ["```mermaid", "flowchart TD"];
  const visited = new Set<string>();
  const edgesEmitted = new Set<string>();

  // BFS from entry point, limited by depth
  const queue: Array<{ id: string; depth: number }> = [{ id: entryPointId, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id) || depth > maxDepth) continue;
    visited.add(id);

    const entity = graph.nodes.get(id)?.entity;
    if (!entity) continue;

    lines.push(`  ${sanitizeId(id)}["${entity.name}"]`);

    for (const targetId of graph.adjacency.get(id) ?? []) {
      const edgeKey = `${id}->${targetId}`;
      if (!edgesEmitted.has(edgeKey)) {
        lines.push(`  ${sanitizeId(id)} --> ${sanitizeId(targetId)}`);
        edgesEmitted.add(edgeKey);
      }
      queue.push({ id: targetId, depth: depth + 1 });
    }
  }

  lines.push("```");
  return lines.join("\n");
}
```

### Edge Density Control

All diagram levels enforce the readability constraint: edges < 2x nodes. Filtering priority:

1. **Transitive reduction** — always applied for L0
2. **Keep all inter-group edges** — these represent architectural boundaries
3. **Within groups** — keep edges involving high-degree nodes first
4. **Drop lowest-weight edges** — if still over budget after steps 1-3

```typescript
function enforceEdgeDensity(nodes: string[], edges: Edge[]): Edge[] {
  const maxEdges = nodes.length * 2;
  if (edges.length <= maxEdges) return edges;

  // Sort by importance: inter-group first, then by node importance, then by weight
  const sorted = [...edges].sort((a, b) => {
    // Prefer inter-group edges
    if (a.isInterGroup && !b.isInterGroup) return -1;
    if (!a.isInterGroup && b.isInterGroup) return 1;
    // Then by weight (higher = more important)
    return b.weight - a.weight;
  });

  return sorted.slice(0, maxEdges);
}
```

### Mermaid ID Sanitization

Mermaid node IDs must be alphanumeric. File paths and special characters are sanitized:

```typescript
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "_");
}
```

---

## 6. Renderer Design

### Design Principles

The renderer is a collection of pure TypeScript functions. Each function takes structured data (from `analysis.json` and config) and returns a Markdown string. No template engines are used.

**Why custom render functions over templates:**
- Zero dependencies for core rendering
- Full type safety — catch errors at compile time
- Testable — pure functions: data in, string out
- No whitespace surprises — the #1 pain point with template engines for Markdown
- IDE support — autocomplete, refactoring, go-to-definition

### Renderer Interface

```typescript
interface RenderContext {
  analysis: AnalysisOutput;
  config: DocgenConfig;
}

interface RenderedFile {
  path: string;       // Relative output path
  content: string;    // Markdown content
}

// Top-level render orchestrator
function renderAll(ctx: RenderContext): RenderedFile[] {
  const files: RenderedFile[] = [];

  files.push(renderArchitectureOverview(ctx));
  files.push(renderScriptCatalog(ctx));
  files.push(...renderDirectoryReadmes(ctx));
  files.push(renderCrossReferenceIndex(ctx));

  return files;
}
```

### Architecture Overview Renderer

Produces `ARCHITECTURE.md` with:
- Project name and description (from config)
- L0 Mermaid diagram (auto-generated from graph)
- Layer descriptions
- Authored principles and design decisions (from config)
- Authored behavioral diagrams (from config)

```typescript
function renderArchitectureOverview(ctx: RenderContext): RenderedFile {
  const { analysis, config } = ctx;
  const sections: string[] = [];

  sections.push(`# ${config.project.name}\n`);
  if (config.project.description) {
    sections.push(`${config.project.description}\n`);
  }

  // Auto-generated L0 diagram
  sections.push("## System Architecture\n");
  sections.push(renderL0Diagram(analysis.groups, analysis.edges, analysis.entities));

  // Layer descriptions
  sections.push("\n## Architectural Layers\n");
  for (const layer of analysis.layers.sort((a, b) => b.level - a.level)) {
    sections.push(`### Layer ${layer.level}: ${layer.label}\n`);
    for (const groupId of layer.groups) {
      const group = analysis.groups.find(g => g.id === groupId);
      if (group) sections.push(`- **${group.label}** (${group.entities.length} entities)\n`);
    }
  }

  // Authored content injection
  if (config.authored?.principles?.length) {
    sections.push("## Principles\n");
    for (const p of config.authored.principles) {
      sections.push(`- ${p}`);
    }
    sections.push("");
  }

  if (config.authored?.designDecisions?.length) {
    sections.push("## Design Decisions\n");
    for (const d of config.authored.designDecisions) {
      sections.push(`### ${d.title}\n`);
      sections.push(`${d.rationale}\n`);
    }
  }

  // Authored diagrams placed in architecture-overview
  const authoredDiagrams = config.authored?.diagrams?.filter(
    d => d.placement === "architecture-overview"
  ) ?? [];
  for (const diagram of authoredDiagrams) {
    sections.push(`## ${diagram.title}\n`);
    sections.push("```mermaid");
    sections.push(diagram.mermaid);
    sections.push("```\n");
  }

  return { path: "ARCHITECTURE.md", content: sections.join("\n") };
}
```

### Per-Directory README Renderer

Produces a `README.md` for each analyzed directory:

```typescript
function renderDirectoryReadmes(ctx: RenderContext): RenderedFile[] {
  const { analysis, config } = ctx;
  const files: RenderedFile[] = [];

  for (const group of analysis.groups) {
    const sections: string[] = [];
    const groupEntities = analysis.entities.filter(e => e.group === group.id);

    // Title and convention-based description
    sections.push(`# ${group.label}\n`);
    const convention = analysis.conventions.find(c =>
      groupEntities.some(e => matchesPattern(e.filePath, c.pattern))
    );
    if (convention) {
      sections.push(`**Role**: ${convention.role}\n`);
    }

    // Authored narrative (if provided)
    const narrative = config.authored?.moduleNarratives?.[group.id];
    if (narrative) {
      sections.push(`${narrative.summary}\n`);
      if (narrative.designDecisions) {
        sections.push(`## Design Decisions\n\n${narrative.designDecisions}\n`);
      }
      if (narrative.howItWorks) {
        sections.push(`## How It Works\n\n${narrative.howItWorks}\n`);
      }
    }

    // L1 diagram
    const groupEdges = analysis.edges.filter(
      e => group.entities.includes(e.source) || group.entities.includes(e.target)
    );
    sections.push("## Dependencies\n");
    sections.push(renderL1Diagram(group, analysis.entities, groupEdges));

    // Entity listing
    sections.push("\n## Contents\n");
    sections.push("| Name | Kind | Importance | Description |");
    sections.push("|------|------|-----------|-------------|");
    for (const entity of groupEntities.sort((a, b) => b.importance - a.importance)) {
      const desc = entity.description ?? "";
      sections.push(`| ${entity.name} | ${entity.kind} | ${entity.importance} | ${desc} |`);
    }

    files.push({ path: `${group.id}/README.md`, content: sections.join("\n") });
  }

  return files;
}
```

### Script Catalog Renderer

Produces `SCRIPTS-CATALOG.md` — a flat, searchable index of all scripts:

```typescript
function renderScriptCatalog(ctx: RenderContext): RenderedFile {
  const { analysis } = ctx;
  const scripts = analysis.entities.filter(
    e => e.kind === "script" || e.kind === "entrypoint"
  );

  const sections: string[] = [];
  sections.push("# Scripts Catalog\n");
  sections.push(`Total: ${scripts.length} scripts\n`);

  // Group by directory for organization
  const byGroup = groupBy(scripts, e => e.group);
  for (const [groupId, groupScripts] of Object.entries(byGroup)) {
    sections.push(`## ${groupId}\n`);
    sections.push("| Script | Entry Point | Dependencies | Description |");
    sections.push("|--------|------------|--------------|-------------|");
    for (const script of groupScripts) {
      const isEntry = script.kind === "entrypoint" ? "Yes" : "No";
      const deps = script.fanOut;
      const desc = script.description ?? "";
      sections.push(`| [${script.name}](${script.filePath}) | ${isEntry} | ${deps} | ${desc} |`);
    }
    sections.push("");
  }

  return { path: "SCRIPTS-CATALOG.md", content: sections.join("\n") };
}
```

### Cross-Reference Index Renderer

Produces a lookup-oriented index showing caller/callee relationships:

```typescript
function renderCrossReferenceIndex(ctx: RenderContext): RenderedFile {
  const { analysis } = ctx;
  const sections: string[] = [];
  sections.push("# Cross-Reference Index\n");

  // Sort entities by importance (most-referenced first)
  const sorted = [...analysis.entities].sort((a, b) => b.importance - a.importance);

  for (const entity of sorted.filter(e => e.importance > 0)) {
    sections.push(`## ${entity.name}\n`);
    sections.push(`- **File**: \`${entity.filePath}\``);
    sections.push(`- **Kind**: ${entity.kind}`);
    sections.push(`- **Layer**: ${entity.layer}`);

    const callers = analysis.edges
      .filter(e => e.target === entity.id)
      .map(e => analysis.entities.find(ent => ent.id === e.source)?.name ?? e.source);
    if (callers.length > 0) {
      sections.push(`- **Called by**: ${callers.join(", ")}`);
    }

    const callees = analysis.edges
      .filter(e => e.source === entity.id)
      .map(e => analysis.entities.find(ent => ent.id === e.target)?.name ?? e.target);
    if (callees.length > 0) {
      sections.push(`- **Calls**: ${callees.join(", ")}`);
    }
    sections.push("");
  }

  return { path: "CROSS-REFERENCE.md", content: sections.join("\n") };
}
```

---

## 7. Configuration Loading

### YAML Parsing

The configuration file (`.docgen.yml`) is parsed using a lightweight YAML parser. The tool reads the file, parses it into a raw object, then validates it against the expected TypeScript type.

```typescript
import { readFileSync } from "fs";
import { parse as parseYaml } from "yaml"; // or a minimal YAML parser

interface DocgenConfig {
  project: {
    name: string;
    description?: string;
  };
  include: string[];
  exclude?: string[];
  output?: {
    directory?: string;  // Default: "_generated-docs"
  };
  sourcePathMappings?: Record<string, string>;
  authored?: AuthoredContent;
}

interface AuthoredContent {
  glossary?: Record<string, string>;
  moduleNarratives?: Record<string, ModuleNarrative>;
  principles?: string[];
  designDecisions?: Array<{ title: string; rationale: string }>;
  diagrams?: Array<AuthoredDiagram>;
}

interface ModuleNarrative {
  summary: string;
  designDecisions?: string;
  howItWorks?: string;
}

interface AuthoredDiagram {
  id: string;
  title: string;
  placement: string;
  mermaid: string;
}
```

### Validation Strategy

Configuration validation uses TypeScript type checking at load time — no external JSON schema validator (e.g., ajv) is required. Validation is implemented as a series of type guards and assertions:

```typescript
function loadConfig(configPath: string): DocgenConfig {
  const raw = readFileSync(configPath, "utf-8");
  const parsed = parseYaml(raw);

  // Validate required fields
  if (!parsed || typeof parsed !== "object") {
    throw new ConfigError("Configuration file must be a YAML object");
  }
  if (!parsed.project?.name) {
    throw new ConfigError("project.name is required");
  }
  if (!Array.isArray(parsed.include) || parsed.include.length === 0) {
    throw new ConfigError("include must be a non-empty array of glob patterns");
  }

  // Validate types of optional fields
  if (parsed.exclude && !Array.isArray(parsed.exclude)) {
    throw new ConfigError("exclude must be an array of glob patterns");
  }
  if (parsed.sourcePathMappings && typeof parsed.sourcePathMappings !== "object") {
    throw new ConfigError("sourcePathMappings must be an object mapping variable names to paths");
  }

  // Validate authored content structure
  if (parsed.authored) {
    validateAuthoredContent(parsed.authored);
  }

  return parsed as DocgenConfig;
}

function validateAuthoredContent(authored: unknown): void {
  if (typeof authored !== "object" || authored === null) {
    throw new ConfigError("authored must be an object");
  }
  const a = authored as Record<string, unknown>;

  if (a.glossary && typeof a.glossary !== "object") {
    throw new ConfigError("authored.glossary must be a key-value object");
  }
  if (a.principles && !Array.isArray(a.principles)) {
    throw new ConfigError("authored.principles must be an array of strings");
  }
  if (a.designDecisions && !Array.isArray(a.designDecisions)) {
    throw new ConfigError("authored.designDecisions must be an array of {title, rationale} objects");
  }
  if (a.diagrams) {
    if (!Array.isArray(a.diagrams)) {
      throw new ConfigError("authored.diagrams must be an array");
    }
    for (const d of a.diagrams) {
      if (!d.id || !d.title || !d.placement || !d.mermaid) {
        throw new ConfigError("Each authored diagram must have id, title, placement, and mermaid fields");
      }
    }
  }
}
```

### Config Resolution

The config file is located by:
1. CLI `--config` flag (explicit path)
2. `.docgen.yml` in the current working directory
3. `.docgen.yaml` in the current working directory (alternate extension)

If no config file is found, the tool exits with a clear error message and exit code 1.

---

## 8. CLI Design

### Commands

| Command | Description |
|---------|-------------|
| `docgen generate` | Full pipeline: analyze source files, produce `analysis.json`, render Markdown |
| `docgen generate --json-only` | Produce only `analysis.json` (skip rendering) |
| `docgen render` | Render from existing `analysis.json` (skip analysis) |
| `docgen validate` | Validate `.docgen.yml` configuration without running analysis |

### Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--config <path>` | `-c` | `.docgen.yml` | Path to configuration file |
| `--output <dir>` | `-o` | From config or `_generated-docs` | Output directory |
| `--json-only` | | `false` | Produce only analysis.json |
| `--verbose` | `-v` | `false` | Show detailed progress and warnings |
| `--quiet` | `-q` | `false` | Suppress all output except errors |

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success — all files generated |
| 1 | Configuration error — file not found, invalid YAML, missing required fields |
| 2 | No files found — include patterns matched zero files |
| 3 | Output error — output directory not writable |
| 4 | Internal error — unexpected failure (bug in the tool) |

### Output Behavior

- **Normal mode**: Print summary line on success (e.g., "Generated 15 files from 230 sources")
- **Verbose mode**: Print each pipeline step, file counts, timing, and all warnings
- **Quiet mode**: No stdout output; only stderr for errors
- **Warnings**: Always written to stderr regardless of mode (unresolvable paths, parse failures)

### CLI Implementation

The CLI is a thin wrapper that parses arguments, loads config, and invokes the pipeline:

```typescript
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "validate") {
    try {
      loadConfig(args.configPath);
      console.log("Configuration is valid.");
      process.exit(0);
    } catch (e) {
      console.error(`Configuration error: ${e.message}`);
      process.exit(1);
    }
  }

  if (args.command === "generate") {
    const config = loadConfig(args.configPath);
    const analysis = await runAnalysis(config);
    writeJson(analysis, config.output?.directory ?? "_generated-docs");

    if (!args.jsonOnly) {
      const rendered = renderAll({ analysis, config });
      writeFiles(rendered, config.output?.directory ?? "_generated-docs");
    }

    if (!args.quiet) {
      const fileCount = rendered?.length ?? 1;
      console.log(`Generated ${fileCount} files from ${analysis.files.length} sources`);
    }
    process.exit(0);
  }

  if (args.command === "render") {
    const config = loadConfig(args.configPath);
    const analysis = readAnalysisJson(config.output?.directory ?? "_generated-docs");
    const rendered = renderAll({ analysis, config });
    writeFiles(rendered, config.output?.directory ?? "_generated-docs");
    process.exit(0);
  }
}
```

---

## 9. Source Path Resolution

### The Problem

Shell scripts frequently use variables in source paths:

```bash
source "$SCRIPTS_ROOT/shared-tools/lib-docgen.sh"
. "${LIB_DIR}/helpers.sh"
source "$PROJECT_ROOT/scripts/hooks/${hook_name}.sh"
```

Static analysis cannot evaluate runtime variable values. The tool uses a multi-step resolution algorithm combining configuration mappings with heuristic fallbacks.

### Resolution Algorithm

```typescript
interface ResolvedPath {
  resolvedPath: string | null;  // null if unresolvable
  confidence: "exact" | "mapped" | "heuristic" | "unresolved";
  originalRaw: string;
}

function resolveSourcePath(
  rawPath: string,
  currentFile: string,
  mappings: Record<string, string>,
  allFiles: string[]
): ResolvedPath {
  // Step 1: Literal path (no variables) -- resolve relative to current file
  if (!rawPath.includes("$")) {
    const resolved = path.resolve(path.dirname(currentFile), rawPath);
    const relative = path.relative(projectRoot, resolved);
    if (allFiles.includes(relative)) {
      return { resolvedPath: relative, confidence: "exact", originalRaw: rawPath };
    }
    return { resolvedPath: null, confidence: "unresolved", originalRaw: rawPath };
  }

  // Step 2: Variable substitution from sourcePathMappings
  let substituted = rawPath;
  for (const [varName, varValue] of Object.entries(mappings)) {
    // Match $VAR, ${VAR}, "$VAR", "${VAR}"
    const patterns = [
      new RegExp(`\\$\\{${varName}\\}`, "g"),
      new RegExp(`\\$${varName}(?=[/\\s"'])`, "g"),
    ];
    for (const pattern of patterns) {
      substituted = substituted.replace(pattern, varValue);
    }
  }

  // Remove surrounding quotes
  substituted = substituted.replace(/^["']|["']$/g, "");

  // Step 3: Check if fully resolved (no remaining $ variables)
  if (!substituted.includes("$")) {
    const normalized = path.normalize(substituted);
    if (allFiles.includes(normalized)) {
      return { resolvedPath: normalized, confidence: "mapped", originalRaw: rawPath };
    }
    // Try with common extensions
    for (const ext of [".sh", ".bash"]) {
      if (allFiles.includes(normalized + ext)) {
        return { resolvedPath: normalized + ext, confidence: "mapped", originalRaw: rawPath };
      }
    }
    return { resolvedPath: null, confidence: "unresolved", originalRaw: rawPath };
  }

  // Step 4: Heuristic -- extract the filename portion and search
  const filename = path.basename(substituted).replace(/\$\{?\w+\}?/g, "*");
  if (!filename.includes("*")) {
    const candidates = allFiles.filter(f => path.basename(f) === filename);
    if (candidates.length === 1) {
      return { resolvedPath: candidates[0], confidence: "heuristic", originalRaw: rawPath };
    }
  }

  // Step 5: Unresolvable -- log warning, mark edge
  return { resolvedPath: null, confidence: "unresolved", originalRaw: rawPath };
}
```

### Handling Unresolved Paths

When a source path cannot be resolved:
1. A warning is emitted to stderr with the file, line number, and raw path
2. The edge is recorded in `analysis.json` with `target: null` and a `resolution: "unresolved"` marker
3. The entity is annotated with an `unresolvedSources` count
4. The generated documentation notes which scripts have unresolved references

### Known Unresolvable Patterns

These patterns are inherently unresolvable by static analysis:
- Computed paths: `source "$dir/$( compute_name ).sh"`
- Loop-based sourcing: `for f in "$dir"/*.sh; do source "$f"; done`
- Conditional paths: `source "${USE_ALT:+alt/}lib.sh"`
- Eval-based: `eval "source $path"`

The tool logs these as warnings and documents them in output. Estimated impact: ~5-10 scripts in a typical codebase.

---

## 10. Convention Detection

### Purpose

Convention detection infers the role of files and directories from naming patterns and structural position. This replaces the hardcoded role classification in the current tool (which uses filename prefixes) with a data-driven approach.

### Detection Algorithm

```typescript
interface ConventionRule {
  pattern: RegExp;
  glob: string;           // Human-readable glob for output
  role: string;
  minMatches: number;     // Minimum files to confirm the convention
}

const BUILTIN_RULES: ConventionRule[] = [
  { pattern: /^hook-.*\.sh$/, glob: "hook-*.sh", role: "lifecycle hook", minMatches: 2 },
  { pattern: /^lib-.*\.sh$/, glob: "lib-*.sh", role: "shared library", minMatches: 2 },
  { pattern: /^heal-.*\.sh$/, glob: "heal-*.sh", role: "self-healing cycle", minMatches: 2 },
  { pattern: /^check-.*\.sh$/, glob: "check-*.sh", role: "validation check", minMatches: 2 },
  { pattern: /^gate-.*\.sh$/, glob: "gate-*.sh", role: "quality gate", minMatches: 2 },
  { pattern: /\.test\.ts$/, glob: "*.test.ts", role: "test file", minMatches: 1 },
  { pattern: /\.config\.(ts|js|json)$/, glob: "*.config.*", role: "configuration", minMatches: 1 },
];

function detectConventions(files: FileEntry[]): Convention[] {
  const conventions: Convention[] = [];

  for (const rule of BUILTIN_RULES) {
    const matches = files.filter(f => rule.pattern.test(path.basename(f.path)));
    if (matches.length >= rule.minMatches) {
      conventions.push({
        pattern: rule.glob,
        role: rule.role,
        matchCount: matches.length,
        examples: matches.slice(0, 3).map(f => f.path),
      });
    }
  }

  return conventions;
}
```

### Directory Role Inference

Beyond filename patterns, the tool infers directory roles from structural signals:

```typescript
interface DirectoryRole {
  directory: string;
  role: string;
  confidence: "high" | "medium";
  signal: string;
}

function inferDirectoryRoles(files: FileEntry[], groups: Group[]): DirectoryRole[] {
  const roles: DirectoryRole[] = [];

  for (const group of groups) {
    const groupFiles = files.filter(f => f.group === group.id);
    const basenames = groupFiles.map(f => path.basename(f.path));

    // Directory contains mostly hooks
    const hookCount = basenames.filter(n => n.startsWith("hook-")).length;
    if (hookCount > groupFiles.length * 0.5) {
      roles.push({
        directory: group.id,
        role: "hook directory",
        confidence: "high",
        signal: `${hookCount}/${groupFiles.length} files match hook-* pattern`,
      });
    }

    // Directory contains a README and mostly libraries
    const libCount = basenames.filter(n => n.startsWith("lib-")).length;
    if (libCount > groupFiles.length * 0.5) {
      roles.push({
        directory: group.id,
        role: "shared library directory",
        confidence: "high",
        signal: `${libCount}/${groupFiles.length} files match lib-* pattern`,
      });
    }

    // Directory is a leaf (no subdirectories with code)
    const hasSubdirs = groups.some(g => g.id.startsWith(group.id + "/"));
    if (!hasSubdirs && group.entities.length > 0) {
      roles.push({
        directory: group.id,
        role: "leaf module",
        confidence: "medium",
        signal: "no subdirectories with code",
      });
    }
  }

  return roles;
}
```

### Convention Output

Detected conventions appear in `analysis.json` and are used by the renderer to:
- Assign descriptive roles to directories in README files
- Group scripts by category in the catalog
- Provide context in the architecture overview

---

## 11. Error Handling

### Strategy: Graceful Degradation

The tool follows a "fail soft, report clearly" strategy. Individual file failures do not halt the pipeline. Only configuration-level or output-level errors cause non-zero exits.

### Error Categories

| Category | Behavior | Exit Code |
|----------|----------|-----------|
| Config not found | Halt with clear message | 1 |
| Config invalid YAML | Halt with field-level error | 1 |
| Config missing required field | Halt identifying the field | 1 |
| No files match include patterns | Halt with message | 2 |
| Output directory not writable | Halt with message | 3 |
| File parse failure (syntax error) | Warn, skip file, continue | 0 |
| Unresolvable source path | Warn, mark edge unresolved, continue | 0 |
| WASM initialization failure | Halt with diagnostic | 4 |
| Unexpected internal error | Halt with stack trace | 4 |

### Parse Failure Handling

When tree-sitter fails to parse a file (syntax errors), the tool:

```typescript
interface ParseResult {
  success: boolean;
  tree?: Parser.Tree;
  errors: ParseError[];
}

interface ParseError {
  file: string;
  line: number;
  column: number;
  message: string;
}

function analyzeFile(filePath: string, source: string, parser: Parser): AnalysisResult {
  const tree = parser.parse(source);

  // Check for ERROR nodes in the tree
  const errors = collectErrorNodes(tree);
  if (errors.length > 0) {
    // Partial parse: extract what we can, log warnings
    console.warn(`[WARN] ${filePath}: ${errors.length} parse error(s), partial extraction`);
    const entities = extractFunctions(tree, filePath); // May be incomplete
    tree.delete(); // Prevent WASM memory leak
    return { entities, edges: [], warnings: errors, partial: true };
  }

  const entities = extractFunctions(tree, filePath);
  const edges = extractSourceEdges(tree, filePath);
  tree.delete();
  return { entities, edges, warnings: [], partial: false };
}
```

### Unresolvable Path Handling

```typescript
interface UnresolvedEdge {
  sourceFile: string;
  rawPath: string;
  line: number;
  reason: string;
}

// Collected during analysis, reported in summary
const unresolvedEdges: UnresolvedEdge[] = [];

function reportUnresolved(edges: UnresolvedEdge[], verbose: boolean): void {
  if (edges.length === 0) return;

  console.warn(`\n[WARN] ${edges.length} unresolvable source path(s):`);
  if (verbose) {
    for (const edge of edges) {
      console.warn(`  ${edge.sourceFile}:${edge.line} -> ${edge.rawPath} (${edge.reason})`);
    }
  } else {
    console.warn(`  Use --verbose to see details`);
  }
}
```

### Invalid Config Field Reporting

Error messages identify the exact field and expected type:

```
Error: Configuration invalid at authored.diagrams[2].placement
  Expected: string
  Got: undefined
  Each authored diagram must have id, title, placement, and mermaid fields.
```

### Recovery Guarantees

1. **No partial output**: If the pipeline fails after producing some files, all output is rolled back (write to temp directory, then atomic rename)
2. **No corrupt analysis.json**: The JSON file is written atomically (write to `.analysis.json.tmp`, then rename)
3. **Deterministic warnings**: Same input always produces same warnings in same order

---

## 12. File Organization

### Source Directory Structure

```
tools/docgen/
  package.json              # Minimal: web-tree-sitter + tree-sitter-bash deps
  tsconfig.json             # TypeScript configuration
  esbuild.config.ts         # Bundle to single .js file

  src/
    index.ts                # CLI entry point (argument parsing, orchestration)
    config.ts               # YAML loading, validation, type definitions
    types.ts                # Shared TypeScript interfaces (Entity, Edge, etc.)

    analyzers/
      interface.ts          # LanguageAnalyzer interface definition
      strategy.ts           # Extension-based analyzer selection (strategy pattern)
      shell/
        index.ts            # Shell analyzer orchestrator
        parser.ts           # web-tree-sitter WASM initialization and parsing
        functions.ts        # Function extraction from CST
        source-chains.ts    # Source/dot statement extraction
        env-vars.ts         # Environment variable usage extraction
        entry-points.ts     # Entry point detection
        path-resolver.ts    # Variable-based source path resolution

    engine/
      graph.ts              # Graph data structure (adjacency list)
      scc.ts                # Tarjan SCC algorithm
      transitive.ts         # Transitive reduction
      importance.ts         # Degree-based importance scoring
      layering.ts           # Longest-path layer assignment
      grouping.ts           # Directory-structure-based grouping
      conventions.ts        # Naming pattern and directory role detection
      serialize.ts          # analysis.json serialization

    renderer/
      index.ts              # Render orchestrator (renderAll)
      architecture.ts       # ARCHITECTURE.md renderer
      directory-readme.ts   # Per-directory README renderer
      script-catalog.ts     # SCRIPTS-CATALOG.md renderer
      cross-reference.ts    # Cross-reference index renderer
      mermaid/
        index.ts            # Mermaid generation orchestrator
        l0-overview.ts      # L0 system overview diagram
        l1-module.ts        # L1 module detail diagram
        l2-flow.ts          # L2 flow detail diagram
        sanitize.ts         # ID sanitization, edge density control
      authored.ts           # Authored content injection logic

  wasm/
    tree-sitter-bash.wasm   # Vendored WASM binary (no download at runtime)

  test/
    unit/
      scc.test.ts           # Tarjan algorithm unit tests
      transitive.test.ts    # Transitive reduction tests
      layering.test.ts      # Longest-path tests
      path-resolver.test.ts # Source path resolution tests
      conventions.test.ts   # Convention detection tests
    integration/
      shell-analyzer.test.ts  # End-to-end shell analysis
      pipeline.test.ts        # Full pipeline integration test
    fixtures/
      sample-scripts/       # Test shell scripts
      expected-output/      # Expected analysis.json and markdown
```

### Module Boundaries

Each directory under `src/` represents a clear responsibility boundary:

- **`analyzers/`** — Language-specific code. Only this directory imports tree-sitter or ts-morph.
- **`engine/`** — Language-agnostic graph processing. Receives `DocFragment[]`, produces `AnalysisOutput`.
- **`renderer/`** — Reads `AnalysisOutput` + config, produces strings. Zero knowledge of source languages.

Cross-boundary imports flow in one direction only: `index.ts` -> `analyzers` -> `engine` -> `renderer`. No circular dependencies.

### Build and Distribution

```json
{
  "scripts": {
    "build": "esbuild src/index.ts --bundle --platform=node --target=node18 --outfile=dist/docgen.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

The bundled `dist/docgen.js` is a single file that includes all TypeScript code. The WASM binary (`tree-sitter-bash.wasm`) is loaded at runtime from a known relative path. Distribution requires only the `.js` file and the `.wasm` file.

### Dependency Summary (Phase 1)

| Dependency | Type | Purpose |
|-----------|------|---------|
| `web-tree-sitter` | Runtime | WASM-based parser engine |
| `tree-sitter-bash` | Runtime (WASM binary) | Bash grammar for tree-sitter |
| `yaml` | Runtime | YAML config file parsing |
| `typescript` | Dev | Type checking |
| `esbuild` | Dev | Bundling to single .js |
| `vitest` | Dev | Unit and integration testing |

Total runtime dependencies: 3 (web-tree-sitter, tree-sitter-bash WASM, yaml parser). No graphology, no template engines, no utility libraries.
