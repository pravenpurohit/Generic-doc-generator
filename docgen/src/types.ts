/**
 * Top-level output structure written to analysis.json.
 * This is the architectural boundary between analysis and rendering.
 */
export interface AnalysisOutput {
  meta: {
    version: string;
    generatedAt: string;
    rootDir: string;
    config: ConfigReference;
  };
  files: FileEntry[];
  entities: Entity[];
  edges: Edge[];
  groups: Group[];
  layers: Layer[];
  conventions: Convention[];
}

export interface ConfigReference {
  path: string;
  hash: string;
}

export interface FileEntry {
  path: string;
  language: FileLanguage;
  size: number;
  mtime: string;
  isEntryPoint: boolean;
  group: string;
  layer: number;
}

export type FileLanguage = "shell" | "typescript" | "json" | "yaml" | "markdown";

export interface Entity {
  id: string;
  kind: EntityKind;
  name: string;
  filePath: string;
  location: { startLine: number; endLine: number };
  signature?: string;
  description?: string;
  parameters?: Parameter[];
  returnType?: string;
  envVars?: EnvVarUsage[];
  exitCodes?: number[];
  fanIn: number;
  fanOut: number;
  importance: number;
  layer: number;
  group: string;
}

export type EntityKind =
  | "function"
  | "class"
  | "interface"
  | "script"
  | "module"
  | "hook"
  | "configuration"
  | "entrypoint";

export interface Parameter {
  name: string;
  description?: string;
  required: boolean;
}

export interface EnvVarUsage {
  name: string;
  mode: "read" | "write" | "read-with-default";
  defaultValue?: string;
}

export interface Edge {
  source: string;
  target: string;
  kind: EdgeKind;
  weight: number;
  inTransitiveReduction: boolean;
}

export type EdgeKind =
  | "calls"
  | "imports"
  | "sources"
  | "spawns"
  | "extends"
  | "implements";

export interface Group {
  id: string;
  label: string;
  entities: string[];
  internalEdgeCount: number;
  externalEdgeCount: number;
}

export interface Layer {
  level: number;
  label: string;
  groups: string[];
}

export interface Convention {
  pattern: string;
  role: string;
  matchCount: number;
  examples: string[];
}
