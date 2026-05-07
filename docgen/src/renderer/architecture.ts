import type { AnalysisOutput } from "../types.js";
import type { DocgenConfig } from "../config.js";
import { renderL0Diagram } from "./mermaid/l0-overview.js";

export interface RenderContext {
  analysis: AnalysisOutput;
  config: DocgenConfig;
}

export interface RenderedFile {
  path: string;
  content: string;
  rootRelative?: boolean;
}

/**
 * Render ARCHITECTURE.md with system overview, layers, and authored content.
 */
export function renderArchitectureOverview(ctx: RenderContext): RenderedFile {
  const { analysis, config } = ctx;
  const sections: string[] = [];

  sections.push(`# ${config.project.name}\n`);
  if (config.project.description) {
    sections.push(`${config.project.description}\n`);
  }

  // Authored diagrams placed in ARCHITECTURE.md (before auto-generated L0)
  const authoredDiagrams =
    config.authored?.diagrams?.filter(
      (d) => d.placement === "ARCHITECTURE.md",
    ) ?? [];
  for (const diagram of authoredDiagrams) {
    sections.push(`## ${diagram.title}\n`);
    sections.push("```mermaid");
    sections.push(diagram.mermaid);
    sections.push("```\n");
  }

  // Auto-generated L0 diagram
  sections.push("## System Architecture\n");
  sections.push(renderL0Diagram(analysis.groups, analysis.edges, analysis.entities));

  // Layer descriptions
  sections.push("\n## Architectural Layers\n");
  const sortedLayers = [...analysis.layers].sort((a, b) => b.level - a.level);

  // Detect duplicate labels across all groups to disambiguate
  const labelCounts = new Map<string, number>();
  for (const group of analysis.groups) {
    labelCounts.set(group.label, (labelCounts.get(group.label) ?? 0) + 1);
  }

  for (const layer of sortedLayers) {
    sections.push(`### Layer ${layer.level}: ${layer.label}\n`);
    for (const groupId of layer.groups) {
      const group = analysis.groups.find((g) => g.id === groupId);
      if (group) {
        const displayLabel = (labelCounts.get(group.label) ?? 0) > 1 ? group.id : group.label;
        sections.push(`- **${displayLabel}** (${group.entities.length} entities)`);
      }
    }
    sections.push("");
  }

  // Authored principles
  if (config.authored?.principles?.length) {
    sections.push("## Principles\n");
    for (const p of config.authored.principles) {
      sections.push(`- ${p}`);
    }
    sections.push("");
  }

  // Authored design decisions
  if (config.authored?.designDecisions?.length) {
    sections.push("## Design Decisions\n");
    for (const d of config.authored.designDecisions) {
      sections.push(`### ${d.title}\n`);
      sections.push(`${d.rationale}\n`);
    }
  }

  return { path: "ARCHITECTURE.md", content: sections.join("\n") };
}
