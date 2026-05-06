import type { Group, Edge, Entity } from "../../types.js";
import { escapeLabel, enforceEdgeDensity } from "./sanitize.js";

/**
 * Render L0 system overview diagram.
 * Each directory group becomes a node; inter-group edges shown.
 * Transitive reduction applied for clarity.
 * Uses short sequential IDs and subgraph grouping by top-level directory.
 */
export function renderL0Diagram(
  groups: Group[],
  edges: Edge[],
  entities: Entity[],
): string {
  const lines: string[] = ["```mermaid", "flowchart TD"];

  // Build entity-to-group lookup
  const entityToGroup = new Map<string, string>();
  for (const entity of entities) {
    entityToGroup.set(entity.id, entity.group);
  }

  // If more than 15 groups, merge low-importance ones
  let displayGroups = groups;
  if (groups.length > 15) {
    const sorted = [...groups].sort(
      (a, b) => b.entities.length + b.externalEdgeCount - (a.entities.length + a.externalEdgeCount),
    );
    displayGroups = sorted.slice(0, 14);
    const otherGroups = sorted.slice(14);
    const otherEntities = otherGroups.flatMap((g) => g.entities);
    displayGroups.push({
      id: "_other",
      label: "other",
      entities: otherEntities,
      internalEdgeCount: 0,
      externalEdgeCount: 0,
    });
  }

  const groupIds = new Set(displayGroups.map((g) => g.id));

  // Assign short sequential IDs
  const shortIdMap = new Map<string, string>();
  displayGroups.forEach((g, idx) => {
    shortIdMap.set(g.id, `g${idx}`);
  });

  // Group nodes by top-level directory prefix for subgraph grouping
  const subgraphMap = new Map<string, Group[]>();
  for (const group of displayGroups) {
    const topLevel = group.id.split("/")[0] ?? group.id;
    const capitalized = topLevel.charAt(0).toUpperCase() + topLevel.slice(1);
    if (!subgraphMap.has(capitalized)) {
      subgraphMap.set(capitalized, []);
    }
    subgraphMap.get(capitalized)!.push(group);
  }

  // Emit nodes grouped by subgraph
  if (subgraphMap.size > 1) {
    for (const [subgraphLabel, subgraphGroups] of subgraphMap) {
      lines.push(`  subgraph ${subgraphLabel}`);
      for (const group of subgraphGroups) {
        const count = group.entities.length;
        const label = escapeLabel(`${group.label} (${count})`);
        lines.push(`    ${shortIdMap.get(group.id)}["${label}"]`);
      }
      lines.push("  end");
    }
  } else {
    // Single top-level directory, no subgraphs needed
    for (const group of displayGroups) {
      const count = group.entities.length;
      const label = escapeLabel(`${group.label} (${count})`);
      lines.push(`  ${shortIdMap.get(group.id)}["${label}"]`);
    }
  }

  // Compute inter-group edges
  const interGroupEdges: Edge[] = [];
  for (const edge of edges) {
    if (!edge.inTransitiveReduction) continue;
    const sourceGroup = entityToGroup.get(edge.source);
    const targetGroup = entityToGroup.get(edge.target);
    if (!sourceGroup || !targetGroup) continue;
    if (sourceGroup === targetGroup) continue;

    // Map to display groups
    const sg = groupIds.has(sourceGroup) ? sourceGroup : "_other";
    const tg = groupIds.has(targetGroup) ? targetGroup : "_other";
    if (sg === tg) continue;

    interGroupEdges.push({ ...edge, source: sg, target: tg });
  }

  // Deduplicate inter-group edges
  const edgeSet = new Map<string, Edge>();
  for (const edge of interGroupEdges) {
    const key = `${edge.source}->${edge.target}`;
    if (edgeSet.has(key)) {
      edgeSet.get(key)!.weight += edge.weight;
    } else {
      edgeSet.set(key, { ...edge });
    }
  }

  // Apply edge density control
  const dedupedEdges = Array.from(edgeSet.values());
  const filteredEdges = enforceEdgeDensity(
    displayGroups.map((g) => g.id),
    dedupedEdges,
  );

  // Emit edges using short IDs
  for (const edge of filteredEdges) {
    const weight = edge.weight > 1 ? `|${edge.weight}|` : "";
    lines.push(`  ${shortIdMap.get(edge.source)} -->${weight} ${shortIdMap.get(edge.target)}`);
  }

  lines.push("```");
  return lines.join("\n");
}
