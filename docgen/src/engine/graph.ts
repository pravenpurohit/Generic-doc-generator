import type { Entity, Edge, EdgeKind } from "../types.js";

export interface GraphNode {
  id: string;
  entity: Entity;
}

export interface EdgeData {
  source: string;
  target: string;
  kind: EdgeKind;
  weight: number;
  inTransitiveReduction: boolean;
}

export interface Graph {
  nodes: Map<string, GraphNode>;
  adjacency: Map<string, Set<string>>;
  reverseAdj: Map<string, Set<string>>;
  edges: Map<string, EdgeData>;
}

export interface ResolvedEdge {
  source: string;
  target: string;
  kind: EdgeKind;
}

/**
 * Build a directed graph from entities and resolved edges.
 */
export function buildGraph(entities: Entity[], resolvedEdges: ResolvedEdge[]): Graph {
  const graph: Graph = {
    nodes: new Map(),
    adjacency: new Map(),
    reverseAdj: new Map(),
    edges: new Map(),
  };

  // Add all entities as nodes
  for (const entity of entities) {
    graph.nodes.set(entity.id, { id: entity.id, entity });
    if (!graph.adjacency.has(entity.id)) {
      graph.adjacency.set(entity.id, new Set());
    }
    if (!graph.reverseAdj.has(entity.id)) {
      graph.reverseAdj.set(entity.id, new Set());
    }
  }

  // Add edges
  for (const edge of resolvedEdges) {
    // Skip edges to non-existent nodes
    if (!graph.nodes.has(edge.source) || !graph.nodes.has(edge.target)) {
      continue;
    }

    // Skip self-loops
    if (edge.source === edge.target) continue;

    const edgeKey = `${edge.source}->${edge.target}`;

    if (graph.edges.has(edgeKey)) {
      // Merge: increment weight
      const existing = graph.edges.get(edgeKey)!;
      existing.weight++;
    } else {
      graph.edges.set(edgeKey, {
        source: edge.source,
        target: edge.target,
        kind: edge.kind,
        weight: 1,
        inTransitiveReduction: true,
      });
      graph.adjacency.get(edge.source)!.add(edge.target);
      graph.reverseAdj.get(edge.target)!.add(edge.source);
    }
  }

  return graph;
}

/**
 * Convert graph edges to the output Edge[] format.
 */
export function graphToEdges(graph: Graph): Edge[] {
  const edges: Edge[] = [];
  for (const edgeData of graph.edges.values()) {
    edges.push({
      source: edgeData.source,
      target: edgeData.target,
      kind: edgeData.kind,
      weight: edgeData.weight,
      inTransitiveReduction: edgeData.inTransitiveReduction,
    });
  }
  return edges;
}
