import type { CompactSummary } from "./compact.js";

export interface FactCheckResult {
  warnings: string[];
}

/**
 * Compare generated markdown against the CompactSummary to detect
 * hallucinated file paths and incorrect file counts.
 */
export function checkFacts(
  markdown: string,
  compact: CompactSummary,
  analysisFiles: string[],
): FactCheckResult {
  const warnings: string[] = [];

  // Check file paths mentioned in the document
  const pathWarnings = checkFilePaths(markdown, analysisFiles);
  warnings.push(...pathWarnings);

  // Check numeric claims about file counts
  const countWarnings = checkFileCounts(markdown, compact);
  warnings.push(...countWarnings);

  return { warnings };
}

/**
 * Extract file paths from the markdown and verify they exist in the analysis.
 */
function checkFilePaths(markdown: string, analysisFiles: string[]): string[] {
  const warnings: string[] = [];
  const fileSet = new Set(analysisFiles);

  // Match patterns that look like file paths:
  // scripts/..., architecture/..., tools/..., specifications/...
  const pathRegex = /(?:scripts|architecture|tools|specifications)\/[\w./-]+(?:\.(?:sh|ts|md|json|yml|yaml))/g;
  let match: RegExpExecArray | null;

  const mentionedPaths = new Set<string>();
  while ((match = pathRegex.exec(markdown)) !== null) {
    mentionedPaths.add(match[0]);
  }

  for (const path of mentionedPaths) {
    if (!fileSet.has(path)) {
      // Check if it's a partial match (directory prefix)
      const isPrefix = analysisFiles.some((f) => f.startsWith(path.replace(/\.[^.]+$/, "")));
      if (!isPrefix) {
        warnings.push(`Path not found in analysis: ${path}`);
      }
    }
  }

  return warnings;
}

/**
 * Extract numeric claims about file counts and compare against actual counts.
 */
function checkFileCounts(markdown: string, compact: CompactSummary): string[] {
  const warnings: string[] = [];

  // Match patterns like "157 shell", "33 TypeScript", "53 canary"
  const countPatterns = [
    { regex: /(\d+)\s+shell/gi, key: "shell" },
    { regex: /(\d+)\s+(?:typescript|TS)/gi, key: "typescript" },
    { regex: /(\d+)\s+(?:json)/gi, key: "json" },
    { regex: /(\d+)\s+(?:yaml|yml)/gi, key: "yaml" },
    { regex: /(\d+)\s+(?:markdown|md)/gi, key: "markdown" },
  ];

  for (const { regex, key } of countPatterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(markdown)) !== null) {
      const claimed = parseInt(match[1], 10);
      const actual = compact.project.fileCounts[key] || 0;

      // Allow some tolerance (the config description may have different counts
      // than what's actually analyzed due to include/exclude patterns)
      if (actual > 0 && Math.abs(claimed - actual) > Math.max(5, actual * 0.1)) {
        warnings.push(
          `File count mismatch for "${key}": document claims ${claimed}, analysis has ${actual}`,
        );
      }
    }
  }

  // Check total file count claims
  const totalRegex = /(\d+)\s+(?:files|sources)/gi;
  let totalMatch: RegExpExecArray | null;
  while ((totalMatch = totalRegex.exec(markdown)) !== null) {
    const claimed = parseInt(totalMatch[1], 10);
    const actual = compact.stats.totalFiles;
    if (actual > 0 && Math.abs(claimed - actual) > Math.max(10, actual * 0.15)) {
      warnings.push(
        `Total file count mismatch: document claims ${claimed}, analysis has ${actual}`,
      );
    }
  }

  return warnings;
}
