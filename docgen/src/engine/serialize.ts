import { writeFileSync, renameSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import type {
  AnalysisOutput,
  FileEntry,
  Entity,
  Edge,
  Group,
  Layer,
  Convention,
  ConfigReference,
} from "../types.js";

interface MetaInput {
  version: string;
  rootDir: string;
  config: ConfigReference;
}

/**
 * Build the full AnalysisOutput object from all engine outputs.
 */
export function buildAnalysisOutput(
  meta: MetaInput,
  files: FileEntry[],
  entities: Entity[],
  edges: Edge[],
  groups: Group[],
  layers: Layer[],
  conventions: Convention[],
): AnalysisOutput {
  return {
    meta: {
      version: meta.version,
      generatedAt: new Date().toISOString(),
      rootDir: meta.rootDir,
      config: meta.config,
    },
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    entities: entities.sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges.sort((a, b) => {
      const cmp = a.source.localeCompare(b.source);
      return cmp !== 0 ? cmp : a.target.localeCompare(b.target);
    }),
    groups: groups.sort((a, b) => a.id.localeCompare(b.id)),
    layers: layers.sort((a, b) => a.level - b.level),
    conventions,
  };
}

/**
 * Write analysis.json atomically (write to tmp, then rename).
 * Uses deterministic JSON serialization with sorted keys.
 */
export function writeAnalysisJson(output: AnalysisOutput, outputDir: string): void {
  mkdirSync(outputDir, { recursive: true });
  const targetPath = join(outputDir, "analysis.json");
  const tmpPath = join(outputDir, ".analysis.json.tmp");

  const json = JSON.stringify(output, null, 2);
  writeFileSync(tmpPath, json, "utf-8");
  renameSync(tmpPath, targetPath);
}
