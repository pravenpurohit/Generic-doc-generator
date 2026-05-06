import { statSync } from "fs";
import type { DocgenConfig } from "../../config.js";

/**
 * Detect whether a file is an entry point script.
 * Entry points have a shebang line + executable permissions,
 * or are explicitly listed in configuration.
 */
export function detectEntryPoint(
  source: string,
  filePath: string,
  config: DocgenConfig,
): boolean {
  const hasShebang = /^#!.*\b(bash|sh)\b/.test(source.split("\n")[0] ?? "");
  const isExecutable = checkExecutablePermission(filePath);
  const isConfigListed = config.include?.some(
    (pattern) => pattern === filePath,
  ) ?? false;

  return (hasShebang && isExecutable) || isConfigListed;
}

/**
 * Check if a file has executable permission.
 */
export function checkExecutablePermission(filePath: string): boolean {
  try {
    const stat = statSync(filePath);
    // Check if any execute bit is set (owner, group, or other)
    return (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}
