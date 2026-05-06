import type { CompactSummary } from "./compact.js";
import type { ArchitectureContext } from "./context-reader.js";
import type { DocgenConfig } from "../config.js";

export interface SynthesisPrompt {
  system: string;
  user: string;
}

/**
 * Build the LLM prompt from structural facts, architecture context, and editorial config.
 */
export function buildSynthesisPrompt(
  compact: CompactSummary,
  context: ArchitectureContext,
  config: DocgenConfig,
): SynthesisPrompt {
  const system = buildSystemPrompt();
  const user = buildUserPrompt(compact, context, config);
  return { system, user };
}

function buildSystemPrompt(): string {
  return `You are a technical documentation writer. You produce Markdown documentation with Mermaid diagrams for developer audiences.`;
}

function buildUserPrompt(
  compact: CompactSummary,
  context: ArchitectureContext,
  config: DocgenConfig,
): string {
  const editorial = config.editorial;
  const authored = config.authored;
  const sections: string[] = [];

  // Task
  sections.push(`## Task
Generate a TOOLKIT-OVERVIEW.md for the following project.`);

  // Audience
  if (editorial?.audiencePerspective) {
    sections.push(`## Audience
${editorial.audiencePerspective}`);
  }

  // Structure
  if (editorial?.overview) {
    const overview = editorial.overview;
    if (overview.orderingPrinciple) {
      sections.push(`## Structure
Follow this ordering: ${overview.orderingPrinciple}`);
    }

    // Diagram sections
    if (overview.diagrams && overview.diagrams.length > 0) {
      const diagramList = overview.diagrams
        .map((d, i) => `${i + 1}. ${d.id} — ${d.description}`)
        .join("\n");
      sections.push(`Generate these sections with diagrams:
${diagramList}
10. Quick Reference — commands, key files, where things live`);
    }
  }

  // Omit
  if (editorial?.overview?.omit && editorial.overview.omit.length > 0) {
    const omitList = editorial.overview.omit.map((item) => `- ${item}`).join("\n");
    sections.push(`## Omit
${omitList}`);
  }

  // Project Facts
  sections.push(`## Project Facts (from static analysis)
${JSON.stringify(compact, null, 2)}`);

  // Design Principles
  if (authored?.principles && authored.principles.length > 0) {
    const principlesList = authored.principles
      .map((p, i) => `${i + 1}. ${p}`)
      .join("\n");
    sections.push(`## Design Principles (include verbatim)
${principlesList}`);
  }

  // Design Decisions
  if (authored?.designDecisions && authored.designDecisions.length > 0) {
    const decisions = authored.designDecisions
      .map((d) => `### ${d.title}\n${d.rationale}`)
      .join("\n\n");
    sections.push(`## Design Decisions
${decisions}`);
  }

  // Glossary
  if (authored?.glossary) {
    const glossaryEntries = Object.entries(authored.glossary)
      .map(([term, def]) => `**${term}**: ${def}`)
      .join("\n");
    sections.push(`## Glossary
${glossaryEntries}`);
  }

  // Authored Diagrams
  if (authored?.diagrams && authored.diagrams.length > 0) {
    const diagramBlocks = authored.diagrams
      .map((d) => `### ${d.title}\n\`\`\`mermaid\n${d.mermaid.trim()}\n\`\`\``)
      .join("\n\n");
    sections.push(`## Authored Diagrams (use these verbatim where appropriate)
${diagramBlocks}`);
  }

  // Architecture Context
  if (context.architectureExcerpts.length > 0) {
    const excerpts = context.architectureExcerpts
      .map((e) => `### ${e.file}\n${e.excerpt}`)
      .join("\n\n");
    sections.push(`## Architecture Context (for WHY explanations)
${excerpts}`);
  }

  // Behavioral Context
  if (context.behavioralExcerpts.length > 0) {
    const excerpts = context.behavioralExcerpts
      .map((e) => `### ${e.file}\n${e.excerpt}`)
      .join("\n\n");
    sections.push(`## Behavioral Context (for accurate diagrams)
${excerpts}`);
  }

  // Output Format
  sections.push(`## Output Format
- Produce a single Markdown document
- Use \`\`\`mermaid code blocks for all diagrams
- Use --- horizontal rules between major sections
- Include a Quick Reference section at the end with: Common Commands (bash code block), Key Files (table), Where Things Live (table)
- Every file count and path you mention MUST come from the Project Facts section — do not invent numbers
- When referencing specific scripts, ONLY use paths from the following verified list:

### Verified File Paths (use ONLY these — do not invent paths)
${compact.entryPointPaths.join("\n")}`);

  return sections.join("\n\n");
}
