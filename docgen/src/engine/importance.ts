import type { Graph } from "./graph.js";

/**
 * Compute degree-based importance for all nodes.
 * importance = fanIn + fanOut
 * Mutates entity.fanIn, entity.fanOut, entity.importance in place.
 */
export function computeDegreeImportance(graph: Graph): void {
  for (const [nodeId, node] of graph.nodes) {
    const fanIn = graph.reverseAdj.get(nodeId)?.size ?? 0;
    const fanOut = graph.adjacency.get(nodeId)?.size ?? 0;
    node.entity.fanIn = fanIn;
    node.entity.fanOut = fanOut;
    node.entity.importance = fanIn + fanOut;
  }
}
