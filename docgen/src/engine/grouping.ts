import { basename } from "path";
import type { Entity, Edge, Group } from "../types.js";

/**
 * Group entities by their containing directory path.
 * Compute internal and external edge counts for each group.
 */
export function buildGroups(entities: Entity[], edges: Edge[]): Group[] {
  // Collect entities by group (directory)
  const groupMap = new Map<string, string[]>();

  for (const entity of entities) {
    const groupId = entity.group;
    if (!groupMap.has(groupId)) {
      groupMap.set(groupId, []);
    }
    groupMap.get(groupId)!.push(entity.id);
  }

  // Build entity-to-group lookup
  const entityToGroup = new Map<string, string>();
  for (const entity of entities) {
    entityToGroup.set(entity.id, entity.group);
  }

  // Build groups with edge counts
  const groups: Group[] = [];
  for (const [groupId, entityIds] of groupMap) {
    let internalEdgeCount = 0;
    let externalEdgeCount = 0;

    for (const edge of edges) {
      const sourceGroup = entityToGroup.get(edge.source);
      const targetGroup = entityToGroup.get(edge.target);

      if (sourceGroup === groupId || targetGroup === groupId) {
        if (sourceGroup === groupId && targetGroup === groupId) {
          internalEdgeCount++;
        } else {
          externalEdgeCount++;
        }
      }
    }

    groups.push({
      id: groupId,
      label: basename(groupId) || groupId,
      entities: entityIds,
      internalEdgeCount,
      externalEdgeCount,
    });
  }

  return groups.sort((a, b) => a.id.localeCompare(b.id));
}
