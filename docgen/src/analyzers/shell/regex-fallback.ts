/**
 * Regex-based fallback analyzer for shell scripts.
 * Used when tree-sitter WASM is unavailable (e.g., Node.js 25+ incompatibility).
 */
import { dirname } from "path";
import type { Entity, Parameter } from "../../types.js";
import type { RawEdge } from "../interface.js";

/**
 * Extract function definitions using regex patterns.
 */
export function extractFunctionsRegex(source: string, filePath: string): Entity[] {
  const entities: Entity[] = [];
  const lines = source.split("\n");

  // Match function definitions: funcname() { or function funcname {
  const funcPattern = /^(?:function\s+)?(\w[\w-]*)\s*\(\s*\)\s*\{?|^function\s+(\w[\w-]*)\s*\{?/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(funcPattern);
    if (!match) continue;

    const name = match[1] || match[2];
    if (!name) continue;

    // Find the end of the function (matching braces)
    let braceCount = 0;
    let started = false;
    let endLine = i;

    for (let j = i; j < lines.length; j++) {
      const l = lines[j];
      for (const ch of l) {
        if (ch === "{") { braceCount++; started = true; }
        if (ch === "}") { braceCount--; }
      }
      if (started && braceCount <= 0) {
        endLine = j;
        break;
      }
    }

    // Extract leading comments
    const comments: string[] = [];
    for (let j = i - 1; j >= 0; j--) {
      const cl = lines[j].trim();
      if (cl.startsWith("#") && !cl.startsWith("#!")) {
        comments.unshift(cl.replace(/^#\s?/, "").trim());
      } else if (cl === "") {
        continue;
      } else {
        break;
      }
    }

    // Extract positional params from function body
    const bodyText = lines.slice(i, endLine + 1).join("\n");
    const params = extractPositionalParamsRegex(bodyText);

    entities.push({
      id: `file:${filePath}#${name}`,
      kind: "function",
      name,
      filePath,
      location: { startLine: i + 1, endLine: endLine + 1 },
      parameters: params,
      description: comments.length > 0 ? comments.join(" ") : undefined,
      fanIn: 0,
      fanOut: 0,
      importance: 0,
      layer: 0,
      group: dirname(filePath),
    });
  }

  return entities;
}

/**
 * Extract positional parameters from function body text.
 */
function extractPositionalParamsRegex(bodyText: string): Parameter[] {
  const params: Parameter[] = [];
  const seen = new Set<string>();

  // Match $1, $2, etc.
  const simplePattern = /\$(\d+)/g;
  let m;
  while ((m = simplePattern.exec(bodyText)) !== null) {
    const paramName = `$${m[1]}`;
    if (!seen.has(paramName)) {
      seen.add(paramName);
      params.push({ name: paramName, required: true });
    }
  }

  // Match ${1}, ${2:-default}, etc.
  const expandPattern = /\$\{(\d+)(?:[:-][^}]*)?\}/g;
  while ((m = expandPattern.exec(bodyText)) !== null) {
    const paramName = `$${m[1]}`;
    if (!seen.has(paramName)) {
      seen.add(paramName);
      params.push({ name: paramName, required: true });
    }
  }

  return params.sort((a, b) => {
    const numA = parseInt(a.name.replace("$", ""), 10);
    const numB = parseInt(b.name.replace("$", ""), 10);
    return numA - numB;
  });
}

/**
 * Extract source/dot include statements using regex.
 */
export function extractSourceEdgesRegex(source: string, filePath: string): RawEdge[] {
  const edges: RawEdge[] = [];
  const lines = source.split("\n");

  // Match: source "path" or . "path" or source $VAR/path
  const sourcePattern = /^\s*(?:source|\.)\s+["']?([^"'\s#]+)["']?/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comments
    if (line.trim().startsWith("#")) continue;

    const match = line.match(sourcePattern);
    if (!match) continue;

    edges.push({
      sourceFile: filePath,
      targetPath: match[1],
      kind: "sources",
      line: i + 1,
    });
  }

  return edges;
}

/**
 * Extract environment variable usage using regex.
 */
export function extractEnvVarsRegex(source: string): string[] {
  const envVars = new Set<string>();

  // Match ${VAR}, $VAR (uppercase with underscores = likely env vars)
  const patterns = [
    /\$\{([A-Z][A-Z0-9_]*)\}/g,
    /\$([A-Z][A-Z0-9_]*)/g,
  ];

  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(source)) !== null) {
      envVars.add(m[1]);
    }
  }

  return Array.from(envVars).sort();
}

/**
 * Detect if a file is an entry point using regex.
 */
export function detectEntryPointRegex(source: string): boolean {
  // Has shebang
  if (source.startsWith("#!/")) return true;

  // Has main guard
  if (source.includes('BASH_SOURCE') && source.includes('$0')) return true;

  return false;
}

/**
 * Shell builtins and common commands to skip when detecting intra-file calls.
 */
const SHELL_BUILTINS = new Set([
  "echo", "printf", "local", "export", "return", "exit", "shift",
  "set", "unset", "eval", "exec", "source", "cd", "test", "true",
  "false", "read", "declare", "typeset",
]);

/**
 * Extract intra-file function calls using regex.
 * For each function body, scan for lines that call other known functions in the same file.
 */
export function extractIntraFileCallsRegex(
  source: string,
  filePath: string,
  functionNames: string[],
): RawEdge[] {
  const edges: RawEdge[] = [];
  if (functionNames.length === 0) return edges;

  // Filter out builtins from function names to avoid false positives
  const validNames = functionNames.filter((n) => !SHELL_BUILTINS.has(n));
  if (validNames.length === 0) return edges;

  const nameSet = new Set(validNames);
  const lines = source.split("\n");

  // Match function definitions to find their bodies
  const funcPattern = /^(?:function\s+)?(\w[\w-]*)\s*\(\s*\)\s*\{?|^function\s+(\w[\w-]*)\s*\{?/;

  // Find function boundaries
  const funcBounds: Array<{ name: string; startLine: number; endLine: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(funcPattern);
    if (!match) continue;
    const name = match[1] || match[2];
    if (!name) continue;

    // Find end of function (matching braces)
    let braceCount = 0;
    let started = false;
    let endLine = i;
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === "{") { braceCount++; started = true; }
        if (ch === "}") { braceCount--; }
      }
      if (started && braceCount <= 0) {
        endLine = j;
        break;
      }
    }
    funcBounds.push({ name, startLine: i, endLine });
  }

  // For each function body, scan for calls to other known functions
  for (const func of funcBounds) {
    if (!nameSet.has(func.name)) continue;

    for (let i = func.startLine + 1; i <= func.endLine; i++) {
      const line = lines[i];
      if (!line) continue;
      const trimmed = line.trim();
      // Skip comments
      if (trimmed.startsWith("#")) continue;

      // Check if line starts with a known function name (after optional whitespace)
      // Pattern: optional whitespace + function name + (space, end-of-line, pipe, semicolon, etc.)
      for (const targetName of validNames) {
        if (targetName === func.name) continue; // Skip self-calls
        const callPattern = new RegExp(`^\\s*${escapeRegex(targetName)}(\\s|$|\\||;|&)`);
        if (callPattern.test(line)) {
          edges.push({
            sourceFile: filePath,
            sourceEntity: `file:${filePath}#${func.name}`,
            targetPath: filePath,
            targetEntity: `file:${filePath}#${targetName}`,
            kind: "calls",
            line: i + 1,
          });
          break; // Only one call per line per target
        }
      }
    }
  }

  return edges;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
