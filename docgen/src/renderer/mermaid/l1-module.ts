import type { Group, Entity, Edge } from "../../types.js";
import { sanitizeId, enforceEdgeDensity, escapeLabel } from "./sanitize.js";

/**
 * Render L1 module detail diagram for a single group.
 * Shows functions within the group and their internal relationships.
 */
export function renderL1Diagram(
  group: Group,
  entities: Entity[],
  edges: Edge[],
): string {
  const lines: string[] = ["```mermaid", "flowchart TD"];

  const groupEntities = entities.filter((e) => group.entities.includes(e.id));

  // Node count control: keep top-30 by importance if over limit
  const displayEntities =
    groupEntities.length > 30
      ? [...groupEntities].sort((a, b) => b.importance - a.importance).slice(0, 30)
      : groupEntities;

  const displayIds = new Set(displayEntities.map((e) => e.id));

  // Emit nodes
  for (const entity of displayEntities) {
    const label = escapeLabel(entity.name);
    if (entity.kind === "entrypoint") {
      lines.push(`  ${sanitizeId(entity.id)}(["${label}"])`);
    } else {
      lines.push(`  ${sanitizeId(entity.id)}["${label}"]`);
    }
  }

  // Emit intra-group edges
  const intraEdges = edges.filter(
    (e) => displayIds.has(e.source) && displayIds.has(e.target),
  );

  const filteredEdges = enforceEdgeDensity(
    Array.from(displayIds),
    intraEdges,
  );

  for (const edge of filteredEdges) {
    const style = edge.kind === "sources" ? "-.->" : "-->";
    lines.push(`  ${sanitizeId(edge.source)} ${style} ${sanitizeId(edge.target)}`);
  }

  lines.push("```");
  return lines.join("\n");
}
