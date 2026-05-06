import { resolve, dirname, relative, normalize, basename } from "path";
import type { ResolvedPath } from "../interface.js";

/**
 * Resolve a raw source path into an actual file path.
 *
 * Resolution steps:
 * 1. Literal path (no variables) - resolve relative to current file
 * 2. Variable substitution from sourcePathMappings
 * 3. Check if fully resolved after substitution
 * 4. Heuristic filename match
 * 5. Unresolved fallback
 */
export function resolveSourcePath(
  rawPath: string,
  currentFile: string,
  mappings: Record<string, string>,
  allFiles: string[],
  projectRoot?: string,
): ResolvedPath {
  const root = projectRoot ?? process.cwd();
  const cleaned = stripQuotes(rawPath);

  // Step 1: Literal path (no variables)
  if (!cleaned.includes("$")) {
    const resolved = resolve(dirname(currentFile), cleaned);
    const rel = relative(root, resolved);
    const normalized = normalize(rel);
    if (allFiles.includes(normalized)) {
      return { resolvedPath: normalized, confidence: "exact", originalRaw: rawPath };
    }
    // Try without leading ./
    const withoutDot = normalized.replace(/^\.\//, "");
    if (allFiles.includes(withoutDot)) {
      return { resolvedPath: withoutDot, confidence: "exact", originalRaw: rawPath };
    }
    return { resolvedPath: null, confidence: "unresolved", originalRaw: rawPath };
  }

  // Step 2: Variable substitution
  let substituted = cleaned;
  for (const [varName, varValue] of Object.entries(mappings)) {
    const patterns = [
      new RegExp(`\\$\\{${varName}\\}`, "g"),
      new RegExp(`\\$${varName}(?=[/\\s"']|$)`, "g"),
    ];
    for (const pattern of patterns) {
      substituted = substituted.replace(pattern, varValue);
    }
  }

  // Remove surrounding quotes after substitution
  substituted = substituted.replace(/^["']|["']$/g, "");

  // Step 3: Check if fully resolved
  if (!substituted.includes("$")) {
    const normalized = normalize(substituted);
    if (allFiles.includes(normalized)) {
      return { resolvedPath: normalized, confidence: "mapped", originalRaw: rawPath };
    }
    // Try with common extensions
    for (const ext of [".sh", ".bash"]) {
      if (allFiles.includes(normalized + ext)) {
        return { resolvedPath: normalized + ext, confidence: "mapped", originalRaw: rawPath };
      }
    }
    return { resolvedPath: null, confidence: "unresolved", originalRaw: rawPath };
  }

  // Step 4: Heuristic - extract filename and search
  const filename = basename(substituted).replace(/\$\{?\w+\}?/g, "");
  if (filename && !filename.includes("$")) {
    const candidates = allFiles.filter((f) => basename(f) === filename);
    if (candidates.length === 1) {
      return { resolvedPath: candidates[0], confidence: "heuristic", originalRaw: rawPath };
    }
  }

  // Step 5: Unresolved
  return { resolvedPath: null, confidence: "unresolved", originalRaw: rawPath };
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}
