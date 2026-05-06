import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

export interface ArchitectureExcerpt {
  file: string;
  excerpt: string;
}

export interface BehavioralExcerpt {
  file: string;
  excerpt: string;
}

export interface ArchitectureContext {
  architectureExcerpts: ArchitectureExcerpt[];
  behavioralExcerpts: BehavioralExcerpt[];
}

/** Scripts whose header comments provide behavioral context for diagrams. */
const BEHAVIORAL_SCRIPTS = [
  "scripts/heal/cycles/heal-light-cycle.sh",
  "scripts/workflows/reviews/run-mega-review.sh",
  "scripts/quality-gates/progress-tracking/auto-continuation.sh",
  "scripts/shared-tools/lib-progress-bus.sh",
  "scripts/shared-tools/lib-evidence.sh",
];

/**
 * Read the architecture/ directory and key behavioral scripts to extract
 * WHY knowledge for the LLM synthesis step.
 */
export async function readArchitectureContext(rootDir: string): Promise<ArchitectureContext> {
  const architectureExcerpts = readArchitectureDir(rootDir);
  const behavioralExcerpts = readBehavioralScripts(rootDir);

  return { architectureExcerpts, behavioralExcerpts };
}

/**
 * Read each .md file in architecture/ and extract the intro section
 * (first 50 lines or until first ## after the intro).
 */
function readArchitectureDir(rootDir: string): ArchitectureExcerpt[] {
  const archDir = join(rootDir, "architecture");
  const excerpts: ArchitectureExcerpt[] = [];

  let entries: string[];
  try {
    entries = readdirSync(archDir);
  } catch {
    return excerpts;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;

    const fullPath = join(archDir, entry);
    try {
      const stat = statSync(fullPath);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }

    try {
      const content = readFileSync(fullPath, "utf-8");
      const excerpt = extractIntroSection(content);
      if (excerpt) {
        excerpts.push({ file: `architecture/${entry}`, excerpt });
      }
    } catch {
      continue;
    }
  }

  return excerpts;
}

/**
 * Extract the intro section: first 50 lines or until the first ## heading
 * after the initial title (# heading).
 */
function extractIntroSection(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let pastTitle = false;

  for (let i = 0; i < Math.min(lines.length, 50); i++) {
    const line = lines[i];

    // Skip the first # title line
    if (!pastTitle && line.startsWith("# ")) {
      pastTitle = true;
      result.push(line);
      continue;
    }

    // Stop at the next ## heading after the title
    if (pastTitle && line.startsWith("## ")) {
      break;
    }

    result.push(line);
  }

  return result.join("\n").trim();
}

/**
 * Read the first 30 comment lines from key behavioral scripts.
 */
function readBehavioralScripts(rootDir: string): BehavioralExcerpt[] {
  const excerpts: BehavioralExcerpt[] = [];

  for (const scriptPath of BEHAVIORAL_SCRIPTS) {
    const fullPath = join(rootDir, scriptPath);
    try {
      const content = readFileSync(fullPath, "utf-8");
      const excerpt = extractCommentHeader(content, 30);
      if (excerpt) {
        excerpts.push({ file: scriptPath, excerpt });
      }
    } catch {
      // Script may not exist — skip silently
      continue;
    }
  }

  return excerpts;
}

/**
 * Extract the first N comment lines from a shell script.
 * Skips the shebang line and stops at the first non-comment, non-empty line.
 */
function extractCommentHeader(content: string, maxLines: number): string {
  const lines = content.split("\n");
  const comments: string[] = [];
  let started = false;

  for (const line of lines) {
    if (comments.length >= maxLines) break;

    // Skip shebang
    if (line.startsWith("#!")) continue;

    // Skip leading blank lines
    if (!started && line.trim() === "") continue;

    if (line.startsWith("#") || line.trim() === "") {
      started = true;
      comments.push(line);
    } else {
      break;
    }
  }

  return comments.join("\n").trim();
}
