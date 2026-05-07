import type { RenderContext, RenderedFile } from "./architecture.js";

/**
 * Render GETTING-STARTED.md from editorial config and analysis data.
 * Produces onboarding content: quick-start commands, key concepts, and directory overview.
 */
export function renderGettingStarted(ctx: RenderContext): RenderedFile | null {
  const { analysis, config } = ctx;
  const editorial = config.editorial;

  // Only generate if there's editorial onboarding content
  if (!editorial?.onboarding) return null;

  const sections: string[] = [];

  // Title
  const title = editorial.overview?.title ?? "Getting Started";
  sections.push(`# ${title}\n`);

  // Quick Start section
  if (editorial.onboarding.quickStartCommands?.length) {
    sections.push("## Quick Start\n");
    sections.push("```bash");
    for (const cmd of editorial.onboarding.quickStartCommands) {
      sections.push(cmd);
    }
    sections.push("```\n");
  }

  // Key Concepts section
  if (editorial.onboarding.keyConceptsToExplain?.length) {
    sections.push("## Key Concepts\n");
    const glossary = config.authored?.glossary ?? {};
    for (const concept of editorial.onboarding.keyConceptsToExplain) {
      // Extract the key term (part before parenthetical) for matching
      const keyTerm = concept.replace(/\s*\(.*\)\s*$/, "").trim();
      // Match glossary keys using word-boundary match against the key term
      let definition: string | undefined;
      for (const [key, value] of Object.entries(glossary)) {
        const keyPattern = new RegExp(`(?:^|[\\s(])${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[\\s)])`, "i");
        if (keyPattern.test(keyTerm) || keyTerm.toLowerCase() === key.toLowerCase()) {
          definition = value;
          break;
        }
      }
      if (definition) {
        sections.push(`- **${concept}**: ${definition}`);
      } else {
        sections.push(`- **${concept}**`);
      }
    }
    sections.push("");
  }

  // Directory Overview section
  sections.push("## Directory Overview\n");
  sections.push("| Directory | Files | Dominant Kind |");
  sections.push("|-----------|-------|---------------|");

  // Group by top-level directory (first path segment)
  const topLevelMap = new Map<string, { count: number; kinds: Map<string, number> }>();
  for (const group of analysis.groups) {
    const topLevel = group.id.split("/")[0] ?? group.id;
    if (!topLevelMap.has(topLevel)) {
      topLevelMap.set(topLevel, { count: 0, kinds: new Map() });
    }
    const entry = topLevelMap.get(topLevel)!;
    entry.count += group.entities.length;

    // Count entity kinds
    const groupEntities = analysis.entities.filter((e) => e.group === group.id);
    for (const entity of groupEntities) {
      entry.kinds.set(entity.kind, (entry.kinds.get(entity.kind) ?? 0) + 1);
    }
  }

  for (const [dir, data] of topLevelMap) {
    // Find dominant kind
    let dominantKind = "—";
    let maxCount = 0;
    for (const [kind, count] of data.kinds) {
      if (count > maxCount) {
        maxCount = count;
        dominantKind = kind;
      }
    }
    sections.push(`| ${dir} | ${data.count} | ${dominantKind} |`);
  }
  sections.push("");

  return { path: "GETTING-STARTED.md", content: sections.join("\n") };
}
