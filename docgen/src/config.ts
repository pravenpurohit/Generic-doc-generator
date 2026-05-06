import { readFileSync, existsSync } from "fs";
import { parse as parseYaml } from "yaml";
import { createHash } from "crypto";

export interface EditorialConfig {
  audiencePerspective?: string;
  overview?: {
    title?: string;
    orderingPrinciple?: string;
    diagrams?: Array<{ id: string; description: string }>;
    omit?: string[];
  };
  perModule?: {
    emphasis?: string;
    omit?: string;
  };
  onboarding?: {
    quickStartCommands?: string[];
    keyConceptsToExplain?: string[];
  };
}

export interface DocgenConfig {
  project: {
    name: string;
    description?: string;
  };
  include: string[];
  exclude?: string[];
  output?: {
    directory?: string;
  };
  sourcePathMappings?: Record<string, string>;
  authored?: AuthoredContent;
  editorial?: EditorialConfig;
}

export interface AuthoredContent {
  glossary?: Record<string, string>;
  moduleNarratives?: Record<string, ModuleNarrative>;
  principles?: string[];
  designDecisions?: Array<{ title: string; rationale: string }>;
  diagrams?: Array<AuthoredDiagram>;
}

export interface ModuleNarrative {
  summary: string;
  designDecisions?: string;
  howItWorks?: string;
}

export interface AuthoredDiagram {
  id: string;
  title: string;
  placement: string;
  mermaid: string;
}

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Resolve the config file path using priority:
 * 1. Explicit CLI path
 * 2. .docgen.yml in cwd
 * 3. .docgen.yaml in cwd
 */
export function resolveConfigPath(explicitPath?: string, cwd?: string): string {
  const dir = cwd ?? process.cwd();

  if (explicitPath) {
    if (!existsSync(explicitPath)) {
      throw new ConfigError(`Config file not found: ${explicitPath}`, "config");
    }
    return explicitPath;
  }

  const ymlPath = `${dir}/.docgen.yml`;
  if (existsSync(ymlPath)) return ymlPath;

  const yamlPath = `${dir}/.docgen.yaml`;
  if (existsSync(yamlPath)) return yamlPath;

  throw new ConfigError(
    "No configuration file found. Create .docgen.yml or specify --config path.",
    "config",
  );
}

/**
 * Load and validate the docgen configuration file.
 */
export function loadConfig(configPath: string): DocgenConfig {
  const raw = readFileSync(configPath, "utf-8");
  const parsed = parseYaml(raw);

  if (!parsed || typeof parsed !== "object") {
    throw new ConfigError("Configuration file must be a YAML object");
  }

  const obj = parsed as Record<string, unknown>;

  if (!obj.project || typeof obj.project !== "object") {
    throw new ConfigError("project section is required", "project");
  }

  const project = obj.project as Record<string, unknown>;
  if (!project.name || typeof project.name !== "string") {
    throw new ConfigError("project.name is required and must be a string", "project.name");
  }

  if (!Array.isArray(obj.include) || obj.include.length === 0) {
    throw new ConfigError(
      "include must be a non-empty array of glob patterns",
      "include",
    );
  }

  if (obj.exclude !== undefined && !Array.isArray(obj.exclude)) {
    throw new ConfigError("exclude must be an array of glob patterns", "exclude");
  }

  if (
    obj.sourcePathMappings !== undefined &&
    (typeof obj.sourcePathMappings !== "object" || obj.sourcePathMappings === null)
  ) {
    throw new ConfigError(
      "sourcePathMappings must be an object mapping variable names to paths",
      "sourcePathMappings",
    );
  }

  if (obj.authored !== undefined) {
    validateAuthoredContent(obj.authored);
  }

  return parsed as unknown as DocgenConfig;
}

function validateAuthoredContent(authored: unknown): void {
  if (typeof authored !== "object" || authored === null) {
    throw new ConfigError("authored must be an object", "authored");
  }

  const a = authored as Record<string, unknown>;

  if (a.glossary !== undefined && (typeof a.glossary !== "object" || a.glossary === null)) {
    throw new ConfigError("authored.glossary must be a key-value object", "authored.glossary");
  }

  if (a.principles !== undefined && !Array.isArray(a.principles)) {
    throw new ConfigError(
      "authored.principles must be an array of strings",
      "authored.principles",
    );
  }

  if (a.designDecisions !== undefined && !Array.isArray(a.designDecisions)) {
    throw new ConfigError(
      "authored.designDecisions must be an array of {title, rationale} objects",
      "authored.designDecisions",
    );
  }

  if (a.diagrams !== undefined) {
    if (!Array.isArray(a.diagrams)) {
      throw new ConfigError("authored.diagrams must be an array", "authored.diagrams");
    }
    for (let i = 0; i < a.diagrams.length; i++) {
      const d = a.diagrams[i] as Record<string, unknown>;
      if (!d.id || !d.title || !d.placement || !d.mermaid) {
        throw new ConfigError(
          `authored.diagrams[${i}] must have id, title, placement, and mermaid fields`,
          `authored.diagrams[${i}]`,
        );
      }
    }
  }
}

/**
 * Compute SHA-256 hash of a config file for cache invalidation.
 */
export function computeConfigHash(configPath: string): string {
  const content = readFileSync(configPath, "utf-8");
  return createHash("sha256").update(content).digest("hex");
}
