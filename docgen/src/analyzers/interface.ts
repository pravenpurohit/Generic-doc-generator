import type { Entity, Edge, FileEntry, EnvVarUsage, Parameter } from "../types.js";

/**
 * A fragment of documentation extracted from a single source file.
 */
export interface DocFragment {
  file: FileEntry;
  entities: Entity[];
  rawEdges: RawEdge[];
  warnings: string[];
}

/**
 * A raw edge before path resolution.
 */
export interface RawEdge {
  sourceFile: string;
  sourceEntity?: string;
  targetPath: string;
  targetEntity?: string;
  kind: "sources" | "calls" | "spawns";
  line?: number;
}

/**
 * Result of parsing a single file.
 */
export interface ParseResult {
  success: boolean;
  entities: Entity[];
  rawEdges: RawEdge[];
  warnings: string[];
  partial: boolean;
}

/**
 * Resolved path with confidence level.
 */
export interface ResolvedPath {
  resolvedPath: string | null;
  confidence: "exact" | "mapped" | "heuristic" | "unresolved";
  originalRaw: string;
}

/**
 * Interface that all language analyzers must implement.
 */
export interface LanguageAnalyzer {
  /** File extensions this analyzer handles */
  extensions: string[];

  /** Initialize the analyzer (load WASM, etc.) */
  init(): Promise<void>;

  /** Analyze a single file and return extracted documentation fragments */
  analyzeFile(filePath: string, source: string): Promise<ParseResult>;

  /** Clean up resources */
  dispose(): void;
}
