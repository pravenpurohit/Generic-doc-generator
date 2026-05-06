import type { RenderContext, RenderedFile } from "./architecture.js";

/**
 * Render CROSS-REFERENCE.md - lookup-oriented index of caller/callee relationships.
 */
export function renderCrossReferenceIndex(ctx: RenderContext): RenderedFile {
  const { analysis } = ctx;
  const sections: string[] = [];
  sections.push("# Cross-Reference Index\n");

  // Sort entities by importance (highest first)
  const sorted = [...analysis.entities].sort((a, b) => b.importance - a.importance);

  for (const entity of sorted.filter((e) => e.importance > 0)) {
    sections.push(`## ${entity.name}\n`);
    sections.push(`- **File**: \`${entity.filePath}\``);
    sections.push(`- **Kind**: ${entity.kind}`);
    sections.push(`- **Layer**: ${entity.layer}`);

    const callers = analysis.edges
      .filter((e) => e.target === entity.id)
      .map(
        (e) =>
          analysis.entities.find((ent) => ent.id === e.source)?.name ?? e.source,
      );
    if (callers.length > 0) {
      sections.push(`- **Called by**: ${callers.join(", ")}`);
    }

    const callees = analysis.edges
      .filter((e) => e.source === entity.id)
      .map(
        (e) =>
          analysis.entities.find((ent) => ent.id === e.target)?.name ?? e.target,
      );
    if (callees.length > 0) {
      sections.push(`- **Calls**: ${callees.join(", ")}`);
    }
    sections.push("");
  }

  return { path: "CROSS-REFERENCE.md", content: sections.join("\n") };
}
