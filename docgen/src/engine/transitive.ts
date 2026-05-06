import type { Graph } from "./graph.js";

/**
 * Topological sort using DFS (reverse post-order).
 * Assumes the graph is a DAG.
 */
export function topologicalSort(graph: Graph): string[] {
  const visited = new Set<string>();
  const result: string[] = [];

  function dfs(node: string): void {
    if (visited.has(node)) return;
    visited.add(node);
    for (const neighbor of graph.adjacency.get(node) ?? new Set<string>()) {
      dfs(neighbor);
    }
    result.push(node);
  }

  for (const nodeId of graph.nodes.keys()) {
    dfs(nodeId);
  }

  return result.reverse();
}

/**
 * Compute transitive reduction by marking edges.
 * An edge u->v is NOT in the transitive reduction if v is reachable
 * from u through another path (not using the direct u->v edge).
 *
 * Mutates edge.inTransitiveReduction in place.
 */
export function computeTransitiveReduction(graph: Graph): void {
  for (const u of graph.nodes.keys()) {
    const directSuccessors = graph.adjacency.get(u) ?? new Set<string>();
    if (directSuccessors.size <= 1) continue;

    for (const v of directSuccessors) {
      // Check if v is reachable from u through other successors
      const reachable = new Set<string>();
      for (const w of directSuccessors) {
        if (w === v) continue;
        collectReachable(graph, w, reachable, v);
      }

      if (reachable.has(v)) {
        const edgeKey = `${u}->${v}`;
        const edge = graph.edges.get(edgeKey);
        if (edge) {
          edge.inTransitiveReduction = false;
        }
      }
    }
  }
}

/**
 * BFS to collect all nodes reachable from start.
 * Optionally stops early if target is found.
 */
function collectReachable(
  graph: Graph,
  start: string,
  visited: Set<string>,
  target?: string,
): void {
  const queue = [start];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (visited.has(node)) continue;
    visited.add(node);
    if (target && node === target) return;
    for (const neighbor of graph.adjacency.get(node) ?? new Set<string>()) {
      if (!visited.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }
}
