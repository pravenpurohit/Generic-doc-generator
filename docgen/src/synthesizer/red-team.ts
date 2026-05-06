import type { CompactSummary } from "./compact.js";

/**
 * Build a red-team (adversarial reviewer) prompt that evaluates a generated document
 * against ground truth data and an optional reference document.
 */
export function buildRedTeamPrompt(
  draft: string,
  compact: CompactSummary,
  factWarnings: string[],
  mermaidWarnings: string[],
  referenceDoc?: string,
): { system: string; user: string } {
  const system = `You are an adversarial documentation reviewer. Your job is to find EVERY factual error, missing section, broken diagram, wrong path, hallucinated count, tone violation, and structural gap in the document under review. Be exhaustive and specific. Do not rubber-stamp.`;

  const sections: string[] = [];

  sections.push(`## Task
Red-team the following generated documentation. Find all issues.`);

  sections.push(`## Ground Truth (from static analysis)
- Total files analyzed: ${compact.stats.totalFiles}
- Total entities: ${compact.stats.totalEntities}
- Total groups: ${compact.stats.totalGroups}
- Total edges: ${compact.stats.totalEdges}
- File counts by type: ${JSON.stringify(compact.project.fileCounts)}
- Shared libraries: ${compact.sharedLibraries.map((l) => `${l.name} (${l.functions.length} functions, ${l.consumerCount} consumers)`).join(", ")}
- Layers: ${compact.layers.map((l) => `L${l.level}: ${l.label} (${l.groupCount} groups)`).join(", ")}`);

  if (factWarnings.length > 0) {
    sections.push(`## Already-Detected Fact-Check Issues
${factWarnings.map((w) => `- ${w}`).join("\n")}`);
  }

  if (mermaidWarnings.length > 0) {
    sections.push(`## Already-Detected Mermaid Issues
${mermaidWarnings.map((w) => `- ${w}`).join("\n")}`);
  }

  if (referenceDoc) {
    sections.push(`## Reference Document (hand-written, gold standard)
Compare the generated doc against this reference for structure, tone, depth, and coverage:

${referenceDoc}`);
  }

  sections.push(`## Evaluation Criteria
For each criterion, output PASS or FAIL with specific details:

1. ACCURACY: Every file path must include the correct extension (.sh, .ts, .md). No invented paths.
2. COUNTS: All numeric claims (file counts, library counts, consumer counts) must match ground truth.
3. DIAGRAMS: All Mermaid blocks must use valid syntax. Authored diagrams from config must appear verbatim.
4. COMPLETENESS: All 10 sections must be present (pitch, pipeline, gates, reviews, progress, directory, libraries, defense, self-heal, quick-ref).
5. TONE: Written for "a developer joining the team who understands shell scripting and CI/CD." Not too formal, not too casual.
6. DEPTH: Covers key concepts without listing every internal function. Matches the selective depth of the reference.
7. STRUCTURE: Uses --- separators between sections. Has Mermaid diagrams in each section. Has tables in Quick Reference.

## Document Under Review

${draft}`);

  sections.push(`## Output Format
Produce a structured list of findings:
- For each issue: [CRITERION] [SEVERITY: critical/major/minor] Description of the issue and what the correct value should be.
- At the end: Summary with total counts per severity.`);

  return { system, user: sections.join("\n\n") };
}

/**
 * Build a revision prompt that takes a draft and red-team findings and produces a fixed version.
 */
export function buildRevisionPrompt(
  draft: string,
  redTeamFindings: string,
  factWarnings: string[],
  mermaidWarnings: string[],
): { system: string; user: string } {
  const system = `You are a technical documentation writer. You are revising a document based on specific feedback from a reviewer. Fix ALL identified issues while preserving the overall structure and content that was not flagged.`;

  const sections: string[] = [];

  sections.push(`## Task
Revise the document below to fix ALL issues identified by the red-team reviewer.`);

  sections.push(`## Red-Team Findings (fix ALL of these)
${redTeamFindings}`);

  if (factWarnings.length > 0) {
    sections.push(`## Automated Fact-Check Warnings (also fix these)
${factWarnings.map((w) => `- ${w}`).join("\n")}`);
  }

  if (mermaidWarnings.length > 0) {
    sections.push(`## Automated Mermaid Warnings (also fix these)
${mermaidWarnings.map((w) => `- ${w}`).join("\n")}`);
  }

  sections.push(`## Rules for Revision
- Fix every issue identified above
- Do NOT remove content that was not flagged
- Do NOT change the overall section structure
- All file paths MUST include .sh or .ts extensions
- All numeric counts MUST match the ground truth provided in the findings
- Authored Mermaid diagrams MUST be used verbatim when provided
- Output the COMPLETE revised document — ALL sections, ALL diagrams, ALL tables
- The output MUST be 250+ lines of Markdown. Do NOT summarize or truncate.
- If unsure about a fix, keep the original text rather than removing it`);

  sections.push(`## Document to Revise

${draft}`);

  return { system, user: sections.join("\n\n") };
}
