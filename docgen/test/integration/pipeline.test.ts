import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "child_process";
import { readFileSync, existsSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "../fixtures");
const OUTPUT_DIR = join(FIXTURES_DIR, "_test-output");

describe("docgen pipeline integration", () => {
  beforeAll(() => {
    if (existsSync(OUTPUT_DIR)) {
      rmSync(OUTPUT_DIR, { recursive: true });
    }
  });

  it("validate command succeeds on valid config", () => {
    const result = execSync(
      "npx tsx ../../src/index.ts validate --config .docgen.yml",
      { cwd: FIXTURES_DIR, encoding: "utf-8" },
    );
    expect(result).toContain("Configuration is valid");
  });

  it("generate --json-only produces analysis.json", () => {
    execSync(
      "npx tsx ../../src/index.ts generate --config .docgen.yml --json-only",
      { cwd: FIXTURES_DIR, encoding: "utf-8" },
    );

    const analysisPath = join(OUTPUT_DIR, "analysis.json");
    expect(existsSync(analysisPath)).toBe(true);

    const analysis = JSON.parse(readFileSync(analysisPath, "utf-8"));
    expect(analysis.meta).toBeDefined();
    expect(analysis.meta.version).toBe("0.1.0");
    expect(analysis.entities).toBeInstanceOf(Array);
    expect(analysis.entities.length).toBeGreaterThan(0);
    expect(analysis.edges).toBeInstanceOf(Array);
    expect(analysis.groups).toBeInstanceOf(Array);
  });

  it("generate produces markdown files", () => {
    if (existsSync(OUTPUT_DIR)) {
      rmSync(OUTPUT_DIR, { recursive: true });
    }

    execSync(
      "npx tsx ../../src/index.ts generate --config .docgen.yml",
      { cwd: FIXTURES_DIR, encoding: "utf-8" },
    );

    expect(existsSync(join(OUTPUT_DIR, "analysis.json"))).toBe(true);

    // Check ARCHITECTURE.md
    const archPath = join(OUTPUT_DIR, "ARCHITECTURE.md");
    expect(existsSync(archPath)).toBe(true);
    const archContent = readFileSync(archPath, "utf-8");
    expect(archContent).toContain("# Sample Project");
    expect(archContent).toContain("## Principles");

    // Check SCRIPTS-CATALOG.md
    const catalogPath = join(OUTPUT_DIR, "SCRIPTS-CATALOG.md");
    expect(existsSync(catalogPath)).toBe(true);
    const catalogContent = readFileSync(catalogPath, "utf-8");
    expect(catalogContent).toContain("# Scripts Catalog");

    // Check CROSS-REFERENCE.md
    const xrefPath = join(OUTPUT_DIR, "CROSS-REFERENCE.md");
    expect(existsSync(xrefPath)).toBe(true);
  });

  it("analysis.json contains expected entities", () => {
    const analysisPath = join(OUTPUT_DIR, "analysis.json");
    const analysis = JSON.parse(readFileSync(analysisPath, "utf-8"));

    const scriptEntities = analysis.entities.filter(
      (e: any) => e.kind === "script" || e.kind === "entrypoint",
    );
    expect(scriptEntities.length).toBeGreaterThanOrEqual(5);

    const functionEntities = analysis.entities.filter(
      (e: any) => e.kind === "function",
    );
    expect(functionEntities.length).toBeGreaterThan(5);

    const names = functionEntities.map((e: any) => e.name);
    expect(names).toContain("log_info");
    expect(names).toContain("setup_env");
    expect(names).toContain("check_node");
  });

  it("analysis.json contains resolved edges", () => {
    const analysisPath = join(OUTPUT_DIR, "analysis.json");
    const analysis = JSON.parse(readFileSync(analysisPath, "utf-8"));

    const sourceEdges = analysis.edges.filter((e: any) => e.kind === "sources");
    expect(sourceEdges.length).toBeGreaterThan(0);
  });

  it("analysis.json detects conventions", () => {
    const analysisPath = join(OUTPUT_DIR, "analysis.json");
    const analysis = JSON.parse(readFileSync(analysisPath, "utf-8"));

    const hookConvention = analysis.conventions.find(
      (c: any) => c.pattern === "hook-*.sh",
    );
    expect(hookConvention).toBeDefined();
    expect(hookConvention.role).toBe("lifecycle hook");
    expect(hookConvention.matchCount).toBe(2);

    const checkConvention = analysis.conventions.find(
      (c: any) => c.pattern === "check-*.sh",
    );
    expect(checkConvention).toBeDefined();
  });

  it("determinism: structure is stable across runs", () => {
    const analysisPath = join(OUTPUT_DIR, "analysis.json");
    const first = JSON.parse(readFileSync(analysisPath, "utf-8"));

    execSync(
      "npx tsx ../../src/index.ts generate --config .docgen.yml",
      { cwd: FIXTURES_DIR, encoding: "utf-8" },
    );

    const second = JSON.parse(readFileSync(analysisPath, "utf-8"));

    // Compare everything except timestamp
    first.meta.generatedAt = "IGNORED";
    second.meta.generatedAt = "IGNORED";
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
