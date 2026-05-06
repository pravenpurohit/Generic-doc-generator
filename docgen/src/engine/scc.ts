import type { Graph, GraphNode, EdgeData } from "./graph.js";

/**
 * Tarjan's algorithm for finding Strongly Connected Components.
 * Returns arrays of node IDs, where each array is one SCC.
 */
export function tarjanSCC(graph: Graph): string[][] {
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

    const neighbors = graph.adjacency.get(v) ?? new Set<string>();
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

/**
 * Condense SCCs into single representative nodes.
 * Multi-node SCCs are collapsed; edges are redirected.
 * Returns a new graph that is guaranteed to be a DAG.
 */
export function condenseSCC(graph: Graph, sccs: string[][]): Graph {
  // Map each node to its SCC representative (first element)
  const nodeToRep = new Map<string, string>();
  for (const scc of sccs) {
    const rep = scc[0];
    for (const node of scc) {
      nodeToRep.set(node, rep);
    }
  }

  // Build condensed graph
  const condensed: Graph = {
    nodes: new Map(),
    adjacency: new Map(),
    reverseAdj: new Map(),
    edges: new Map(),
  };

  // Add representative nodes
  for (const scc of sccs) {
    const rep = scc[0];
    const repNode = graph.nodes.get(rep);
    if (repNode) {
      condensed.nodes.set(rep, repNode);
      condensed.adjacency.set(rep, new Set());
      condensed.reverseAdj.set(rep, new Set());
    }
  }

  // Add edges between different SCCs
  for (const [edgeKey, edgeData] of graph.edges) {
    const sourceRep = nodeToRep.get(edgeData.source)!;
    const targetRep = nodeToRep.get(edgeData.target)!;

    if (sourceRep === targetRep) continue; // Internal SCC edge

    const newKey = `${sourceRep}->${targetRep}`;
    if (!condensed.edges.has(newKey)) {
      condensed.edges.set(newKey, {
        source: sourceRep,
        target: targetRep,
        kind: edgeData.kind,
        weight: edgeData.weight,
        inTransitiveReduction: true,
      });
      condensed.adjacency.get(sourceRep)!.add(targetRep);
      condensed.reverseAdj.get(targetRep)!.add(sourceRep);
    } else {
      condensed.edges.get(newKey)!.weight += edgeData.weight;
    }
  }

  return condensed;
}
