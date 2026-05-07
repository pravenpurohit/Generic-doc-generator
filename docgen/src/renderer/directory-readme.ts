import type { RenderContext, RenderedFile } from "./architecture.js";
import { renderL1Diagram } from "./mermaid/l1-module.js";
import { filterWorthyGroups } from "../engine/worthiness.js";
import { sanitizeId, enforceEdgeDensity } from "./mermaid/sanitize.js";

/**
 * Render a README.md for each analyzed directory group that passes
 * the documentation worthiness filter.
 */
export function renderDirectoryReadmes(ctx: RenderContext): RenderedFile[] {
  const { analysis, config } = ctx;
  const files: RenderedFile[] = [];

  // Filter to only groups worthy of standalone documentation
  const worthinessResults = filterWorthyGroups(
    analysis.groups,
    analysis.entities,
    analysis.conventions,
    config,
  );
  const worthyGroupIds = new Set(
    worthinessResults.filter((r) => r.worthy).map((r) => r.groupId),
  );

  for (const group of analysis.groups) {
    if (!worthyGroupIds.has(group.id)) continue;
    const sections: string[] = [];
    const groupEntities = analysis.entities.filter((e) => e.group === group.id);

    // Title
    sections.push(`# ${group.label}\n`);

    // Convention-based role
    const convention = analysis.conventions.find((c) =>
      groupEntities.some((e) => {
        const basename = e.filePath.split("/").pop() ?? "";
        return new RegExp(c.pattern.replace(/\*/g, ".*")).test(basename);
      }),
    );
    if (convention) {
      sections.push(`**Role**: ${convention.role}\n`);
    }

    // Authored narrative
    const narrative = config.authored?.moduleNarratives?.[group.id];
    if (narrative) {
      sections.push(`${narrative.summary}\n`);
      if (narrative.designDecisions) {
        sections.push(`## Design Decisions\n\n${narrative.designDecisions}\n`);
      }
      if (narrative.howItWorks) {
        sections.push(`## How It Works\n\n${narrative.howItWorks}\n`);
      }
    }

    // Per-module authored diagrams (placement matches group output path)
    const groupOutputPath = `${group.id}/README.generated.md`;
    const authoredDiagrams =
      config.authored?.diagrams?.filter(
        (d) => d.placement === groupOutputPath,
      ) ?? [];
    for (const diagram of authoredDiagrams) {
      sections.push(`## ${diagram.title}\n`);
      sections.push("```mermaid");
      sections.push(diagram.mermaid);
      sections.push("```\n");
    }

    // L1 diagram — only emit if there are actual intra-group edges
    const groupEdges = analysis.edges.filter(
      (e) => group.entities.includes(e.source) || group.entities.includes(e.target),
    );
    if (groupEntities.length > 0) {
      // Check if there are actual intra-group edges to display
      const displayEntities =
        groupEntities.length > 30
          ? [...groupEntities].sort((a, b) => b.importance - a.importance).slice(0, 30)
          : groupEntities;
      const displayIds = new Set(displayEntities.map((e) => e.id));
      const intraEdges = groupEdges.filter(
        (e) => displayIds.has(e.source) && displayIds.has(e.target),
      );
      const filteredEdges = enforceEdgeDensity(
        Array.from(displayIds),
        intraEdges,
      );

      if (filteredEdges.length > 0) {
        sections.push("## Dependencies\n");
        sections.push(renderL1Diagram(group, analysis.entities, groupEdges));
      }
    }

    // Entity table
    sections.push("\n## Contents\n");
    sections.push("| Name | Kind | Importance | Description |");
    sections.push("|------|------|-----------|-------------|");
    const sorted = [...groupEntities].sort((a, b) => b.importance - a.importance);
    for (const entity of sorted) {
      const desc = entity.description ?? "";
      sections.push(`| ${entity.name} | ${entity.kind} | ${entity.importance} | ${desc} |`);
    }

    files.push({ path: `${group.id}/README.generated.md`, content: sections.join("\n"), rootRelative: true });
  }

  return files;
}
