import type { RenderContext, RenderedFile } from "./architecture.js";

/**
 * Render SCRIPTS-CATALOG.md - a flat searchable index of all scripts.
 */
export function renderScriptCatalog(ctx: RenderContext): RenderedFile {
  const { analysis } = ctx;
  const scripts = analysis.entities.filter(
    (e) => e.kind === "script" || e.kind === "entrypoint",
  );

  const sections: string[] = [];
  sections.push("# Scripts Catalog\n");
  sections.push(`Total: ${scripts.length} scripts\n`);

  // Group by directory
  const byGroup = new Map<string, typeof scripts>();
  for (const script of scripts) {
    if (!byGroup.has(script.group)) {
      byGroup.set(script.group, []);
    }
    byGroup.get(script.group)!.push(script);
  }

  for (const [groupId, groupScripts] of byGroup) {
    sections.push(`## ${groupId}\n`);
    sections.push("| Script | Entry Point | Dependencies | Description |");
    sections.push("|--------|------------|--------------|-------------|");
    for (const script of groupScripts) {
      const isEntry = script.kind === "entrypoint" ? "Yes" : "No";
      const deps = script.fanOut;
      const desc = script.description ?? "";
      sections.push(
        `| [${script.name}](${script.filePath}) | ${isEntry} | ${deps} | ${desc} |`,
      );
    }
    sections.push("");
  }

  return { path: "SCRIPTS-CATALOG.md", content: sections.join("\n") };
}
