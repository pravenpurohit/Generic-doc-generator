import type { AnalysisOutput } from "../types.js";

export interface CompactSummary {
  project: { name: string; description: string; fileCounts: Record<string, number> };
  groups: Array<{ id: string; label: string; entityCount: number; entryPoints: string[]; layer: number }>;
  sharedLibraries: Array<{ name: string; file: string; functions: string[]; consumerCount: number }>;
  edges: Array<{ source: string; target: string; kind: string }>;
  layers: Array<{ level: number; label: string; groupCount: number }>;
  stats: { totalFiles: number; totalEntities: number; totalEdges: number; totalGroups: number };
  entryPointPaths: string[];
}

/**
 * Compact the full analysis output into a token-efficient summary (~15-20K tokens)
 * suitable for LLM consumption. Filters to entry-point entities and cross-group edges.
 */
export function compactAnalysis(analysis: AnalysisOutput): CompactSummary {
  // File counts by language
  const fileCounts: Record<string, number> = {};
  for (const file of analysis.files) {
    fileCounts[file.language] = (fileCounts[file.language] || 0) + 1;
  }

  // Build groups with entry points only
  const groups = analysis.groups.map((group) => {
    const groupEntities = analysis.entities.filter(
      (e) => e.group === group.id,
    );
    const entryPoints = groupEntities
      .filter((e) => e.kind === "entrypoint" || e.importance > 0)
      .map((e) => e.name);

    // Determine dominant layer for the group
    const layerEntry = analysis.layers.find((l) => l.groups.includes(group.id));
    const layer = layerEntry ? layerEntry.level : 0;

    return {
      id: group.id,
      label: group.label,
      entityCount: groupEntities.length,
      entryPoints,
      layer,
    };
  });

  // Build entity-to-group lookup (needed by both shared libraries and edges)
  const entityGroupMap = new Map<string, string>();
  for (const entity of analysis.entities) {
    entityGroupMap.set(entity.id, entity.group);
  }

  // Identify shared libraries — groups under shared-tools or with high fan-in
  const sharedLibraries: CompactSummary["sharedLibraries"] = [];
  for (const group of analysis.groups) {
    const isSharedLib =
      group.id.includes("shared-tools") || group.id.includes("shared_tools");
    if (!isSharedLib) continue;

    const groupEntities = analysis.entities.filter((e) => e.group === group.id);

    // Group entities by file
    const fileMap = new Map<string, string[]>();
    const fileEntityIds = new Map<string, Set<string>>();
    for (const entity of groupEntities) {
      if (entity.kind === "function" || entity.kind === "entrypoint") {
        const existing = fileMap.get(entity.filePath) || [];
        existing.push(entity.name);
        fileMap.set(entity.filePath, existing);

        const ids = fileEntityIds.get(entity.filePath) || new Set();
        ids.add(entity.id);
        fileEntityIds.set(entity.filePath, ids);
      }
    }

    // Count consumers per file: distinct source groups with edges targeting entities in that file
    for (const [file, fns] of fileMap) {
      const fileIds = fileEntityIds.get(file) || new Set();
      const consumerGroups = new Set<string>();
      for (const edge of analysis.edges) {
        if (fileIds.has(edge.target) && !fileIds.has(edge.source)) {
          const sourceGroup = entityGroupMap.get(edge.source);
          if (sourceGroup && sourceGroup !== group.id) {
            consumerGroups.add(sourceGroup);
          }
        }
      }

      const name = file.split("/").pop()?.replace(/\.(sh|ts)$/, "") || file;
      sharedLibraries.push({
        name,
        file,
        functions: fns.filter((f) => !f.startsWith("_")), // skip internal helpers
        consumerCount: consumerGroups.size,
      });
    }
  }

  // Cross-group edges only (inter-group dependencies)
  const edges: CompactSummary["edges"] = [];
  for (const edge of analysis.edges) {
    const sourceGroup = entityGroupMap.get(edge.source);
    const targetGroup = entityGroupMap.get(edge.target);
    if (sourceGroup && targetGroup && sourceGroup !== targetGroup) {
      edges.push({
        source: sourceGroup,
        target: targetGroup,
        kind: edge.kind,
      });
    }
  }

  // Layers
  const layers = analysis.layers.map((l) => ({
    level: l.level,
    label: l.label,
    groupCount: l.groups.length,
  }));

  // Stats
  const stats = {
    totalFiles: analysis.files.length,
    totalEntities: analysis.entities.length,
    totalEdges: analysis.edges.length,
    totalGroups: analysis.groups.length,
  };

  // Entry point file paths (for LLM to reference accurately)
  const entryPointPaths = analysis.files
    .filter((f) => f.isEntryPoint)
    .map((f) => f.path)
    .sort();

  return {
    project: {
      name: analysis.meta.rootDir.split("/").pop() || "project",
      description: "",
      fileCounts,
    },
    groups,
    sharedLibraries,
    edges,
    layers,
    stats,
    entryPointPaths,
  };
}
