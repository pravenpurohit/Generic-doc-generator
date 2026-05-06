import type { Group, Convention, Entity } from "../types.js";
import type { DocgenConfig } from "../config.js";

/**
 * Documentation Worthiness Filter
 *
 * Determines which directory groups deserve a standalone README.
 * Uses a multi-signal scoring approach based on academic research
 * (IEEE TSE 2023: "Prioritizing Documentation Effort Based on
 * PageRank-Like Algorithm and Simple Filtering Rules").
 *
 * Signals:
 * 1. Authored narrative override (always generate)
 * 2. Anti-pattern directory names (never generate)
 * 3. Depth from include root (never if too deep)
 * 4. External edge participation (structural significance)
 * 5. Entity count relative to median (content density)
 * 6. Convention match (architectural role)
 *
 * This is generic across projects — no project-specific logic.
 */

/** Directory name patterns that indicate test/fixture data, not architecture */
const ANTI_PATTERN_NAMES = new Set([
  "fixtures",
  "fixture",
  "testdata",
  "test-data",
  "__tests__",
  "__mocks__",
  "mocks",
  "mock",
  "samples",
  "sample",
  "input",
  "output",
  "expected",
  "expected-output",
  "snapshots",
  "__snapshots__",
  "golden",
  "stubs",
  "fakes",
  "dummy",
  "vendor",
  "vendored",
  "third-party",
  "third_party",
  "node_modules",
  "dist",
  "build",
  ".git",
]);

/** Maximum directory depth from project root for README generation */
const MAX_DEPTH = 3;

/** Minimum worthiness score to generate a README (out of 5 possible) */
const WORTHINESS_THRESHOLD = 2;

export interface WorthinessResult {
  groupId: string;
  worthy: boolean;
  score: number;
  reason: string;
}

/**
 * Filter groups to only those worthy of standalone documentation.
 *
 * A group is worthy if:
 * - It has an authored narrative in config (always worthy), OR
 * - It passes all negative filters AND scores >= threshold
 *
 * A group is never worthy if:
 * - Any path segment matches anti-pattern names
 * - Its depth exceeds MAX_DEPTH
 */
export function filterWorthyGroups(
  groups: Group[],
  entities: Entity[],
  conventions: Convention[],
  config: DocgenConfig,
): WorthinessResult[] {
  // Compute median entity count for relative density scoring
  const entityCounts = groups.map((g) => g.entities.length).sort((a, b) => a - b);
  const medianEntityCount = entityCounts.length > 0
    ? entityCounts[Math.floor(entityCounts.length / 2)]
    : 1;

  const results: WorthinessResult[] = [];

  for (const group of groups) {
    const result = scoreGroup(group, entities, conventions, config, medianEntityCount);
    results.push(result);
  }

  return results;
}

function scoreGroup(
  group: Group,
  entities: Entity[],
  conventions: Convention[],
  config: DocgenConfig,
  medianEntityCount: number,
): WorthinessResult {
  const groupId = group.id;

  // Signal 1: Authored narrative override — always worthy
  if (config.authored?.moduleNarratives?.[groupId]) {
    return { groupId, worthy: true, score: 5, reason: "has authored narrative" };
  }

  // Signal 2: Anti-pattern directory names — never worthy
  // Check if ANY segment in the path matches anti-patterns
  // This catches both the "fixtures" directory itself AND all its children
  const pathSegments = groupId.split("/");
  for (const segment of pathSegments) {
    if (ANTI_PATTERN_NAMES.has(segment.toLowerCase())) {
      return { groupId, worthy: false, score: 0, reason: `anti-pattern segment: ${segment}` };
    }
  }

  // Signal 3: Depth check — never worthy if too deep
  const depth = pathSegments.length;
  if (depth > MAX_DEPTH) {
    return { groupId, worthy: false, score: 0, reason: `depth ${depth} exceeds max ${MAX_DEPTH}` };
  }

  // Scoring signals (each contributes 0-2 points)
  let score = 0;
  const reasons: string[] = [];

  // Signal 4: External edge participation (structural significance)
  // A directory with external edges is connected to the broader architecture
  if (group.externalEdgeCount > 0) {
    score += 2;
    reasons.push(`${group.externalEdgeCount} external edges`);
  }

  // Signal 5: Content density (entity count relative to median)
  // Directories at or above median density are content-rich
  if (group.entities.length >= medianEntityCount) {
    score += 2;
    reasons.push(`${group.entities.length} entities (median: ${medianEntityCount})`);
  } else if (group.entities.length >= 3) {
    // Partial credit for directories with at least 3 entities
    score += 1;
    reasons.push(`${group.entities.length} entities (below median but >= 3)`);
  }

  // Signal 6: Convention match (architectural role)
  // If the directory matches a detected convention, it has a recognized role
  const groupEntities = entities.filter((e) => e.group === groupId);
  const hasConvention = conventions.some((c) =>
    groupEntities.some((e) => {
      const basename = e.filePath.split("/").pop() ?? "";
      return new RegExp(c.pattern.replace(/\*/g, ".*")).test(basename);
    }),
  );
  if (hasConvention) {
    score += 1;
    reasons.push("matches convention");
  }

  const worthy = score >= WORTHINESS_THRESHOLD;
  const reason = worthy
    ? reasons.join(", ")
    : `score ${score} < threshold ${WORTHINESS_THRESHOLD} (${reasons.join(", ") || "no positive signals"})`;

  return { groupId, worthy, score, reason };
}
