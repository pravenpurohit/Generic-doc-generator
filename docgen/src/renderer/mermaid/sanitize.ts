import type { Edge } from "../../types.js";

/**
 * Sanitize an ID for use in Mermaid diagrams.
 * Mermaid node IDs must be alphanumeric + underscores.
 */
export function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "_");
}

/**
 * Enforce edge density constraint: edges < maxRatio * nodes.
 * Filters edges by priority: inter-group first, then by weight.
 */
export function enforceEdgeDensity(
  nodeIds: string[],
  edges: Edge[],
  maxRatio: number = 2,
): Edge[] {
  const maxEdges = nodeIds.length * maxRatio;
  if (edges.length <= maxEdges) return edges;

  // Sort by priority: higher weight first
  const sorted = [...edges].sort((a, b) => b.weight - a.weight);
  return sorted.slice(0, maxEdges);
}

/**
 * Escape label text for Mermaid (handle quotes and special chars).
 */
export function escapeLabel(label: string): string {
  return label.replace(/"/g, "'").replace(/[[\]]/g, "");
}
