import { basename } from "path";
import type { FileEntry, Convention, Group } from "../types.js";

interface ConventionRule {
  pattern: RegExp;
  glob: string;
  role: string;
  minMatches: number;
}

const BUILTIN_RULES: ConventionRule[] = [
  { pattern: /^hook-.*\.sh$/, glob: "hook-*.sh", role: "lifecycle hook", minMatches: 2 },
  { pattern: /^lib-.*\.sh$/, glob: "lib-*.sh", role: "shared library", minMatches: 2 },
  { pattern: /^heal-.*\.sh$/, glob: "heal-*.sh", role: "self-healing cycle", minMatches: 2 },
  { pattern: /^check-.*\.sh$/, glob: "check-*.sh", role: "validation check", minMatches: 2 },
  { pattern: /^gate-.*\.sh$/, glob: "gate-*.sh", role: "quality gate", minMatches: 2 },
  { pattern: /\.test\.ts$/, glob: "*.test.ts", role: "test file", minMatches: 1 },
  { pattern: /\.config\.(ts|js|json)$/, glob: "*.config.*", role: "configuration", minMatches: 1 },
];

/**
 * Detect naming conventions from file patterns.
 */
export function detectConventions(files: FileEntry[]): Convention[] {
  const conventions: Convention[] = [];

  for (const rule of BUILTIN_RULES) {
    const matches = files.filter((f) => rule.pattern.test(basename(f.path)));
    if (matches.length >= rule.minMatches) {
      conventions.push({
        pattern: rule.glob,
        role: rule.role,
        matchCount: matches.length,
        examples: matches.slice(0, 3).map((f) => f.path),
      });
    }
  }

  return conventions;
}

export interface DirectoryRole {
  directory: string;
  role: string;
  confidence: "high" | "medium";
  signal: string;
}

/**
 * Infer directory roles from structural signals.
 */
export function inferDirectoryRoles(files: FileEntry[], groups: Group[]): DirectoryRole[] {
  const roles: DirectoryRole[] = [];

  for (const group of groups) {
    const groupFiles = files.filter((f) => f.group === group.id);
    if (groupFiles.length === 0) continue;

    const basenames = groupFiles.map((f) => basename(f.path));

    // Directory contains mostly hooks
    const hookCount = basenames.filter((n) => n.startsWith("hook-")).length;
    if (hookCount > groupFiles.length * 0.5) {
      roles.push({
        directory: group.id,
        role: "hook directory",
        confidence: "high",
        signal: `${hookCount}/${groupFiles.length} files match hook-* pattern`,
      });
    }

    // Directory contains mostly libraries
    const libCount = basenames.filter((n) => n.startsWith("lib-")).length;
    if (libCount > groupFiles.length * 0.5) {
      roles.push({
        directory: group.id,
        role: "shared library directory",
        confidence: "high",
        signal: `${libCount}/${groupFiles.length} files match lib-* pattern`,
      });
    }

    // Leaf directory (no subdirectories with code)
    const hasSubdirs = groups.some((g) => g.id.startsWith(group.id + "/"));
    if (!hasSubdirs && group.entities.length > 0) {
      roles.push({
        directory: group.id,
        role: "leaf module",
        confidence: "medium",
        signal: "no subdirectories with code",
      });
    }
  }

  return roles;
}
