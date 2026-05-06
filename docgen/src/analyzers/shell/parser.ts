import Parser from "web-tree-sitter";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync } from "fs";

let parserInstance: Parser | null = null;
let bashLanguage: Parser.Language | null = null;
let treeSitterAvailable = true;

/**
 * Get or create the singleton tree-sitter parser with bash grammar loaded.
 * Returns null if tree-sitter is not available (e.g., Node.js WASM incompatibility).
 */
export async function getParser(): Promise<Parser | null> {
  if (parserInstance) return parserInstance;
  if (!treeSitterAvailable) return null;

  try {
    await Parser.init();
    const wasmPath = resolveWasmPath();
    bashLanguage = await Parser.Language.load(wasmPath);
    parserInstance = new Parser();
    parserInstance.setLanguage(bashLanguage);
    return parserInstance;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[WARN] tree-sitter initialization failed (${message}), using regex fallback`);
    treeSitterAvailable = false;
    return null;
  }
}

/**
 * Parse a shell script source string into a tree-sitter Tree.
 * Caller is responsible for calling tree.delete() after use.
 */
export function parseSource(parser: Parser, source: string): Parser.Tree {
  return parser.parse(source);
}

/**
 * Delete a tree to free WASM memory.
 */
export function deleteTree(tree: Parser.Tree): void {
  tree.delete();
}

/**
 * Resolve the path to tree-sitter-bash.wasm.
 * Looks relative to this file first, then in common locations.
 */
function resolveWasmPath(): string {
  // When running from source
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(thisDir, "../../../node_modules/tree-sitter-wasms/out/tree-sitter-bash.wasm"),
    join(thisDir, "../../../wasm/tree-sitter-bash.wasm"),
    join(thisDir, "../../wasm/tree-sitter-bash.wasm"),
    join(process.cwd(), "node_modules/tree-sitter-wasms/out/tree-sitter-bash.wasm"),
    join(process.cwd(), "wasm/tree-sitter-bash.wasm"),
  ];

  for (const candidate of candidates) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error(
    "tree-sitter-bash.wasm not found. Ensure it exists in the wasm/ directory.",
  );
}

export type { Parser };
