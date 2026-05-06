import type { Graph } from "./graph.js";
import type { Entity, Layer } from "../types.js";
import { topologicalSort } from "./transitive.js";

/**
 * Assign architectural layers using longest-path from leaves.
 * Layer 0 = leaves (no outgoing edges) = infrastructure/utilities.
 * Higher layers = orchestration/entry points.
 */
export function assignLayers(graph: Graph): Map<string, number> {
  const layers = new Map<string, number>();

  // Initialize all nodes to layer 0
  for (const nodeId of graph.nodes.keys()) {
    layers.set(nodeId, 0);
  }

  // Process in reverse topological order (from leaves to roots)
  const topoOrder = topologicalSort(graph);

  for (let i = topoOrder.length - 1; i >= 0; i--) {
    const u = topoOrder[i];
    const successors = graph.adjacency.get(u) ?? new Set<string>();
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
  }

  return layers;
}

/**
 * Assign descriptive labels to layers based on position.
 */
export function assignLayerLabels(
  layerMap: Map<string, number>,
  entities: Entity[],
): Layer[] {
  // Find max layer
  let maxLayer = 0;
  for (const level of layerMap.values()) {
    if (level > maxLayer) maxLayer = level;
  }

  const layers: Layer[] = [];
  for (let level = 0; level <= maxLayer; level++) {
    const nodesAtLevel = Array.from(layerMap.entries())
      .filter(([_, l]) => l === level)
      .map(([id]) => id);

    // Determine groups at this level
    const groupsAtLevel = new Set<string>();
    for (const nodeId of nodesAtLevel) {
      const entity = entities.find((e) => e.id === nodeId);
      if (entity) groupsAtLevel.add(entity.group);
    }

    let label: string;
    if (level === 0) {
      label = "utilities";
    } else if (level === maxLayer) {
      label = "orchestration";
    } else if (level === 1) {
      label = "infrastructure";
    } else {
      label = "services";
    }

    layers.push({
      level,
      label,
      groups: Array.from(groupsAtLevel),
    });
  }

  return layers;
}
