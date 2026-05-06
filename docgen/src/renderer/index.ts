import type { RenderContext, RenderedFile } from "./architecture.js";
import { renderArchitectureOverview } from "./architecture.js";
import { renderDirectoryReadmes } from "./directory-readme.js";
import { renderScriptCatalog } from "./script-catalog.js";
import { renderCrossReferenceIndex } from "./cross-reference.js";
import { renderGettingStarted } from "./getting-started.js";

export type { RenderContext, RenderedFile };

/**
 * Render all documentation files from analysis output and config.
 */
export function renderAll(ctx: RenderContext): RenderedFile[] {
  const files: RenderedFile[] = [];

  files.push(renderArchitectureOverview(ctx));
  files.push(renderScriptCatalog(ctx));
  files.push(...renderDirectoryReadmes(ctx));
  files.push(renderCrossReferenceIndex(ctx));

  const gettingStarted = renderGettingStarted(ctx);
  if (gettingStarted) {
    files.push(gettingStarted);
  }

  return files;
}
