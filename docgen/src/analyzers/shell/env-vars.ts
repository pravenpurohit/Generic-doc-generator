import type Parser from "web-tree-sitter";
import type { EnvVarUsage } from "../../types.js";
import { visitNodes } from "./functions.js";

const POSITIONAL_VARS = new Set(["@", "*", "#", "?", "-", "$", "!", "0"]);

/**
 * Extract environment variable usage from a syntax node.
 * Distinguishes read, write, and read-with-default modes.
 */
export function extractEnvVarUsage(node: Parser.SyntaxNode): EnvVarUsage[] {
  const usages: EnvVarUsage[] = [];

  // Reads: simple_expansion nodes like $VAR
  visitNodes(node, "simple_expansion", (n) => {
    const text = n.text.replace(/^\$/, "");
    if (/^\d+$/.test(text) || POSITIONAL_VARS.has(text)) return;
    if (text.length > 0) {
      usages.push({ name: text, mode: "read" });
    }
  });

  // Reads with defaults or plain reads: expansion nodes like ${VAR} or ${VAR:-default}
  visitNodes(node, "expansion", (n) => {
    const text = n.text;
    // Skip positional params like ${1}
    const posMatch = text.match(/^\$\{(\d+)/);
    if (posMatch) return;

    if (text.includes(":-")) {
      const nameMatch = text.match(/\$\{(\w+):-/);
      const defaultMatch = text.match(/:-([^}]*)\}/);
      if (nameMatch) {
        usages.push({
          name: nameMatch[1],
          mode: "read-with-default",
          defaultValue: defaultMatch?.[1],
        });
      }
    } else {
      const nameMatch = text.match(/\$\{(\w+)\}/);
      if (nameMatch && !POSITIONAL_VARS.has(nameMatch[1])) {
        usages.push({ name: nameMatch[1], mode: "read" });
      }
    }
  });

  // Writes: variable_assignment nodes
  visitNodes(node, "variable_assignment", (n) => {
    const nameNode = n.childForFieldName("name");
    if (nameNode) {
      usages.push({ name: nameNode.text, mode: "write" });
    }
  });

  return deduplicateUsages(usages);
}

/**
 * Deduplicate env var usages, keeping the most specific mode.
 * If a var is both read and read-with-default, keep read-with-default.
 */
export function deduplicateUsages(usages: EnvVarUsage[]): EnvVarUsage[] {
  const map = new Map<string, EnvVarUsage>();

  for (const usage of usages) {
    const key = `${usage.name}:${usage.mode}`;
    if (!map.has(key)) {
      map.set(key, usage);
    }
  }

  return Array.from(map.values());
}
