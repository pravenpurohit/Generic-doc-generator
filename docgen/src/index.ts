import { readFileSync, writeFileSync, statSync, mkdirSync, readdirSync } from "fs";
import { join, relative, dirname, basename, extname } from "path";
import { loadConfig, resolveConfigPath, computeConfigHash } from "./config.js";
import type { DocgenConfig } from "./config.js";
import type { AnalysisOutput, Entity, FileEntry, Edge, FileLanguage } from "./types.js";
import type { RawEdge } from "./analyzers/interface.js";
import { getParser, parseSource, deleteTree } from "./analyzers/shell/parser.js";
import { extractFunctions } from "./analyzers/shell/functions.js";
import { extractSourceEdges } from "./analyzers/shell/source-chains.js";
import { extractEnvVarUsage } from "./analyzers/shell/env-vars.js";
import { detectEntryPoint } from "./analyzers/shell/entry-points.js";
import { resolveSourcePath } from "./analyzers/shell/path-resolver.js";
import { extractFunctionsRegex, extractSourceEdgesRegex, extractEnvVarsRegex, detectEntryPointRegex, extractIntraFileCallsRegex } from "./analyzers/shell/regex-fallback.js";
import { buildGraph, graphToEdges } from "./engine/graph.js";
import type { ResolvedEdge } from "./engine/graph.js";
import { tarjanSCC, condenseSCC } from "./engine/scc.js";
import { computeTransitiveReduction } from "./engine/transitive.js";
import { computeDegreeImportance } from "./engine/importance.js";
import { assignLayers, assignLayerLabels } from "./engine/layering.js";
import { buildGroups } from "./engine/grouping.js";
import { detectConventions } from "./engine/conventions.js";
import { buildAnalysisOutput, writeAnalysisJson } from "./engine/serialize.js";
import { renderAll } from "./renderer/index.js";
import { compactAnalysis } from "./synthesizer/compact.js";
import { readArchitectureContext } from "./synthesizer/context-reader.js";
import { buildSynthesisPrompt } from "./synthesizer/prompt-builder.js";
import { createClient } from "./synthesizer/llm-client.js";
import { validateMermaid } from "./synthesizer/mermaid-validator.js";
import { checkFacts } from "./synthesizer/fact-checker.js";

interface CliArgs {
  rootDir?: string;
  command: "generate" | "render" | "validate" | "synthesize";
  configPath?: string;
  outputDir?: string;
  outputFile?: string;
  jsonOnly: boolean;
  verbose: boolean;
  quiet: boolean;
}

/**
 * Parse CLI arguments.
 */
export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    command: "generate",
    jsonOnly: false,
    verbose: false,
    quiet: false,
  };

  let i = 0;
  // First non-flag argument is the command
  if (argv[0] && !argv[0].startsWith("-")) {
    const cmd = argv[0];
    if (cmd === "generate" || cmd === "render" || cmd === "validate" || cmd === "synthesize") {
      args.command = cmd;
    }
    i = 1;
  }

  for (; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--config":
      case "-c":
        args.configPath = argv[++i];
        break;
      case "--output":
      case "-o":
        if (args.command === "synthesize") {
          args.outputFile = argv[++i];
        } else {
          args.outputDir = argv[++i];
        }
        break;
      case "--json-only":
        args.jsonOnly = true;
        break;
      case "--verbose":
      case "-v":
        args.verbose = true;
        break;
      case "--root":
        args.rootDir = argv[++i];
        break;
      case "--quiet":
      case "-q":
        args.quiet = true;
        break;
    }
  }

  return args;
}

/**
 * Discover files matching include/exclude patterns.
 * Simple glob matching without external dependencies.
 */
function discoverFiles(
  rootDir: string,
  include: string[],
  exclude?: string[],
): string[] {
  const allFiles: string[] = [];

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
          walk(fullPath);
        } else if (stat.isFile()) {
          allFiles.push(relative(rootDir, fullPath));
        }
      } catch {
        continue;
      }
    }
  }

  walk(rootDir);

  // Filter by include patterns
  const included = allFiles.filter((f) => {
    return include.some((pattern) => matchGlob(f, pattern));
  });

  // Filter out excluded
  if (exclude && exclude.length > 0) {
    return included.filter((f) => {
      return !exclude.some((pattern) => matchGlob(f, pattern));
    });
  }

  return included;
}

/**
 * Simple glob matching supporting ** and * patterns.
 * ** matches zero or more path segments (including none).
 */
function matchGlob(filePath: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*\//g, "(.+/)?")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(filePath);
}

/**
 * Determine file language from extension.
 */
function getLanguage(filePath: string): FileLanguage {
  const ext = extname(filePath);
  switch (ext) {
    case ".sh":
    case ".bash":
      return "shell";
    case ".ts":
    case ".tsx":
      return "typescript";
    case ".json":
      return "json";
    case ".yml":
    case ".yaml":
      return "yaml";
    case ".md":
      return "markdown";
    default:
      return "shell";
  }
}

/**
 * Run the full analysis pipeline.
 */
async function runAnalysis(
  config: DocgenConfig,
  rootDir: string,
  verbose: boolean,
): Promise<AnalysisOutput> {
  // Discover files
  const filePaths = discoverFiles(rootDir, config.include, config.exclude);
  if (filePaths.length === 0) {
    console.error("Error: No files match the include patterns.");
    process.exit(2);
  }

  if (verbose) {
    console.log(`Discovered ${filePaths.length} files`);
  }

  // Build file entries
  const files: FileEntry[] = filePaths.map((fp) => {
    const fullPath = join(rootDir, fp);
    let size = 0;
    let mtime = new Date().toISOString();
    try {
      const stat = statSync(fullPath);
      size = stat.size;
      mtime = stat.mtime.toISOString();
    } catch {}
    return {
      path: fp,
      language: getLanguage(fp),
      size,
      mtime,
      isEntryPoint: false,
      group: dirname(fp),
      layer: 0,
    };
  });

  // Analyze shell files
  const shellFiles = files.filter((f) => f.language === "shell");
  const allEntities: Entity[] = [];
  const allRawEdges: RawEdge[] = [];
  const intraFileResolvedEdges: ResolvedEdge[] = [];
  const warnings: string[] = [];

  if (shellFiles.length > 0) {
    const parser = await getParser();
    const useRegex = parser === null;

    if (useRegex && verbose) {
      console.log("Using regex fallback parser (tree-sitter unavailable)");
    }

    for (const file of shellFiles) {
      const fullPath = join(rootDir, file.path);
      let source: string;
      try {
        source = readFileSync(fullPath, "utf-8");
      } catch (err) {
        warnings.push(`Failed to read ${file.path}: ${err}`);
        continue;
      }

      if (useRegex) {
        // Regex fallback path
        const functions = extractFunctionsRegex(source, file.path);
        for (const fn of functions) {
          const envVarNames = extractEnvVarsRegex(source);
          fn.envVars = envVarNames.map((name) => ({ name, mode: "read" as const }));
        }
        allEntities.push(...functions);

        const isEntry = detectEntryPointRegex(source);
        file.isEntryPoint = isEntry;
        const scriptName = basename(file.path, extname(file.path));
        allEntities.push({
          id: `file:${file.path}#${scriptName}`,
          kind: isEntry ? "entrypoint" : "script",
          name: scriptName,
          filePath: file.path,
          location: { startLine: 1, endLine: source.split("\n").length },
          description: extractFileDescription(source),
          fanIn: 0,
          fanOut: 0,
          importance: 0,
          layer: 0,
          group: dirname(file.path),
        });

        const edges = extractSourceEdgesRegex(source, file.path);
        allRawEdges.push(...edges);

        // Extract intra-file function calls
        const functionNames = functions.map((fn) => fn.name);
        const intraCallEdges = extractIntraFileCallsRegex(source, file.path, functionNames);
        for (const callEdge of intraCallEdges) {
          if (callEdge.sourceEntity && callEdge.targetEntity) {
            intraFileResolvedEdges.push({
              source: callEdge.sourceEntity,
              target: callEdge.targetEntity,
              kind: "calls",
            });
          }
        }
      } else {
        // Tree-sitter path
        const tree = parseSource(parser, source);

        try {
          const functions = extractFunctions(tree, file.path);

          for (const fn of functions) {
            const fnNode = tree.rootNode.descendantsOfType("function_definition")
              .find((n) => n.childForFieldName("name")?.text === fn.name);
            if (fnNode) {
              const body = fnNode.childForFieldName("body");
              if (body) {
                fn.envVars = extractEnvVarUsage(body);
              }
            }
          }

          allEntities.push(...functions);

          const isEntry = detectEntryPoint(source, fullPath, config);
          file.isEntryPoint = isEntry;
          const scriptName = basename(file.path, extname(file.path));
          allEntities.push({
            id: `file:${file.path}#${scriptName}`,
            kind: isEntry ? "entrypoint" : "script",
            name: scriptName,
            filePath: file.path,
            location: { startLine: 1, endLine: source.split("\n").length },
            description: extractFileDescription(source),
            fanIn: 0,
            fanOut: 0,
            importance: 0,
            layer: 0,
            group: dirname(file.path),
          });

          const edges = extractSourceEdges(tree, file.path);
          allRawEdges.push(...edges);
        } finally {
          deleteTree(tree);
        }
      }
    }
  }

  // Resolve source paths
  const allFilePaths = files.map((f) => f.path);
  const mappings = config.sourcePathMappings ?? {};
  const resolvedEdges: ResolvedEdge[] = [];

  for (const rawEdge of allRawEdges) {
    const resolved = resolveSourcePath(
      rawEdge.targetPath,
      join(rootDir, rawEdge.sourceFile),
      mappings,
      allFilePaths,
      rootDir,
    );

    if (resolved.resolvedPath) {
      // Find the script entity for the target
      const targetScriptName = basename(resolved.resolvedPath, extname(resolved.resolvedPath));
      const targetId = `file:${resolved.resolvedPath}#${targetScriptName}`;
      const sourceScriptName = basename(rawEdge.sourceFile, extname(rawEdge.sourceFile));
      const sourceId = rawEdge.sourceEntity ?? `file:${rawEdge.sourceFile}#${sourceScriptName}`;

      resolvedEdges.push({
        source: sourceId,
        target: targetId,
        kind: rawEdge.kind,
      });
    } else if (verbose) {
      warnings.push(
        `Unresolved source path: ${rawEdge.sourceFile}:${rawEdge.line ?? "?"} -> ${rawEdge.targetPath}`,
      );
    }
  }

  // Add intra-file resolved edges (from regex fallback call detection)
  resolvedEdges.push(...intraFileResolvedEdges);

  // Build graph and run algorithms
  const graph = buildGraph(allEntities, resolvedEdges);
  const sccs = tarjanSCC(graph);
  const condensed = condenseSCC(graph, sccs);
  computeTransitiveReduction(condensed);

  // Transfer transitive reduction marks back to original graph
  for (const [key, edgeData] of condensed.edges) {
    const originalEdge = graph.edges.get(key);
    if (originalEdge) {
      originalEdge.inTransitiveReduction = edgeData.inTransitiveReduction;
    }
  }

  computeDegreeImportance(graph);

  // Assign layers
  const layerMap = assignLayers(condensed);
  // Transfer layer assignments to entities
  for (const [nodeId, level] of layerMap) {
    const node = graph.nodes.get(nodeId);
    if (node) {
      node.entity.layer = level;
    }
  }

  // Update file entries with layer info
  for (const file of files) {
    const scriptName = basename(file.path, extname(file.path));
    const entityId = `file:${file.path}#${scriptName}`;
    const node = graph.nodes.get(entityId);
    if (node) {
      file.layer = node.entity.layer;
    }
  }

  // Get final entities from graph (with updated importance/layer)
  const finalEntities = Array.from(graph.nodes.values()).map((n) => n.entity);
  const finalEdges = graphToEdges(graph);

  // Build groups
  const groups = buildGroups(finalEntities, finalEdges);

  // Assign layers with labels
  const layers = assignLayerLabels(layerMap, finalEntities);

  // Detect conventions
  const conventions = detectConventions(files);

  // Print warnings
  if (warnings.length > 0) {
    for (const w of warnings) {
      console.warn(`[WARN] ${w}`);
    }
  }

  // Build output
  const configPath = resolveConfigPath(undefined, rootDir);
  const output = buildAnalysisOutput(
    {
      version: "0.1.0",
      rootDir,
      config: { path: configPath, hash: computeConfigHash(configPath) },
    },
    files,
    finalEntities,
    finalEdges,
    groups,
    layers,
    conventions,
  );

  return output;
}

/**
 * Extract file-level description from leading comments.
 * Stops at first separator line or blank comment line.
 * Strips filename prefix patterns and caps at 200 chars.
 */
function extractFileDescription(source: string): string | undefined {
  const lines = source.split("\n");
  const comments: string[] = [];
  let started = false;

  for (const line of lines) {
    // Skip shebang
    if (line.startsWith("#!")) continue;
    // Skip empty lines before comments
    if (!started && line.trim() === "") continue;

    if (line.startsWith("#")) {
      started = true;
      const text = line.replace(/^#\s?/, "");
      const trimmed = text.trim();

      // Stop at separator lines (===, ---, ###, or blank comment lines)
      if (/^[=#-]{3,}/.test(trimmed)) break;
      if (trimmed === "" || /^#\s*$/.test(line)) break;

      if (trimmed) comments.push(trimmed);
    } else {
      break;
    }
  }

  if (comments.length === 0) return undefined;

  let desc = comments.join(" ");

  // Strip filename prefix pattern: "scriptname.sh — rest" or "scriptname — rest"
  const prefixMatch = desc.match(/^[\w.-]+(?:\.sh|\.bash|\.ts)?\s*[—–-]\s*/);
  if (prefixMatch) {
    desc = desc.slice(prefixMatch[0].length);
  }

  // Cap at 200 chars
  if (desc.length > 200) {
    desc = desc.slice(0, 200) + "…";
  }

  return desc;
}

/**
 * Write rendered files to the output directory.
 */
function writeRenderedFiles(files: { path: string; content: string }[], outputDir: string): void {
  for (const file of files) {
    const fullPath = join(outputDir, file.path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.content, "utf-8");
  }
}

/**
 * Main CLI entry point.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  try {
    if (args.command === "validate") {
      const configPath = resolveConfigPath(args.configPath);
      loadConfig(configPath);
      if (!args.quiet) {
        console.log("Configuration is valid.");
      }
      process.exit(0);
    }

    if (args.command === "generate") {
      const configPath = resolveConfigPath(args.configPath);
      const config = loadConfig(configPath);
      const rootDir = args.rootDir ?? dirname(configPath);
      const outputDir = args.outputDir ?? config.output?.directory ?? "docs";
      const fullOutputDir = join(rootDir, outputDir);

      const analysis = await runAnalysis(config, rootDir, args.verbose);
      writeAnalysisJson(analysis, fullOutputDir);

      if (!args.jsonOnly) {
        const rendered = renderAll({ analysis, config });
        writeRenderedFiles(rendered, fullOutputDir);

        if (!args.quiet) {
          console.log(
            `Generated ${rendered.length + 1} files from ${analysis.files.length} sources`,
          );
        }
      } else {
        if (!args.quiet) {
          console.log(`Wrote analysis.json from ${analysis.files.length} sources`);
        }
      }
      process.exit(0);
    }

    if (args.command === "render") {
      const configPath = resolveConfigPath(args.configPath);
      const config = loadConfig(configPath);
      const rootDir = args.rootDir ?? dirname(configPath);
      const outputDir = args.outputDir ?? config.output?.directory ?? "docs";
      const fullOutputDir = join(rootDir, outputDir);

      const analysisPath = join(fullOutputDir, "analysis.json");
      let analysis: AnalysisOutput;
      try {
        const raw = readFileSync(analysisPath, "utf-8");
        analysis = JSON.parse(raw) as AnalysisOutput;
      } catch {
        console.error(`Error: Cannot read ${analysisPath}. Run 'generate' first.`);
        process.exit(3);
      }

      const rendered = renderAll({ analysis, config });
      writeRenderedFiles(rendered, fullOutputDir);

      if (!args.quiet) {
        console.log(`Rendered ${rendered.length} files from analysis.json`);
      }
      process.exit(0);
    }

    if (args.command === "synthesize") {
      const configPath = resolveConfigPath(args.configPath);
      const config = loadConfig(configPath);
      const rootDir = args.rootDir ?? dirname(configPath);
      const outputDir = args.outputDir ?? config.output?.directory ?? "docs";
      const fullOutputDir = join(rootDir, outputDir);

      // 1. Read analysis.json
      const analysisPath = join(fullOutputDir, "analysis.json");
      let analysis: AnalysisOutput;
      try {
        const raw = readFileSync(analysisPath, "utf-8");
        analysis = JSON.parse(raw) as AnalysisOutput;
      } catch {
        console.error(`Error: Cannot read ${analysisPath}. Run 'generate' first.`);
        process.exit(3);
      }

      // 2. Compact analysis
      if (args.verbose) console.log("Compacting analysis...");
      const compact = compactAnalysis(analysis);
      compact.project.name = config.project.name;
      compact.project.description = config.project.description || "";

      // 3. Read architecture context
      if (args.verbose) console.log("Reading architecture context...");
      const context = await readArchitectureContext(rootDir);

      // 4. Build prompt
      if (args.verbose) console.log("Building synthesis prompt...");
      const { system, user } = buildSynthesisPrompt(compact, context, config);

      if (args.verbose) {
        const tokenEstimate = Math.round((system.length + user.length) / 4);
        console.log(`Prompt size: ~${tokenEstimate} tokens (${system.length + user.length} chars)`);
      }

      // 5. Create LLM client
      const llmClient = await createClient();

      // ═══════════════════════════════════════════════════════════════
      // PASS 1: Generate draft
      // ═══════════════════════════════════════════════════════════════
      if (!args.quiet) console.log("Pass 1: Generating draft...");
      const draft1 = await llmClient.generate(system, user);

      if (!draft1) {
        console.error("Error: LLM returned empty response");
        process.exit(5);
      }

      // Validate draft 1
      const mermaid1 = validateMermaid(draft1);
      const analysisFiles = analysis.files.map((f) => f.path);
      const facts1 = checkFacts(draft1, compact, analysisFiles);

      if (args.verbose) {
        console.log(`  Draft 1: ${draft1.split("\n").length} lines, ${mermaid1.warnings.length} mermaid warnings, ${facts1.warnings.length} fact warnings`);
      }

      // ═══════════════════════════════════════════════════════════════
      // PASS 2: Red-team draft 1
      // ═══════════════════════════════════════════════════════════════
      if (!args.quiet) console.log("Pass 2: Red-teaming draft...");

      // Read reference doc if available
      let referenceDoc: string | undefined;
      const refPath = join(rootDir, "TOOLKIT-OVERVIEW.md");
      try {
        referenceDoc = readFileSync(refPath, "utf-8");
      } catch {
        // No reference doc available — red-team without it
      }

      const { buildRedTeamPrompt, buildRevisionPrompt } = await import("./synthesizer/red-team.js");
      const rtPrompt1 = buildRedTeamPrompt(draft1, compact, facts1.warnings, mermaid1.warnings, referenceDoc);
      const redTeamFindings1 = await llmClient.generate(rtPrompt1.system, rtPrompt1.user);

      if (args.verbose) {
        const findingLines = redTeamFindings1.split("\n").filter((l) => l.trim()).length;
        console.log(`  Red-team findings: ${findingLines} lines`);
      }

      // ═══════════════════════════════════════════════════════════════
      // PASS 3: Revise based on red-team findings
      // ═══════════════════════════════════════════════════════════════
      if (!args.quiet) console.log("Pass 3: Revising based on red-team findings...");
      const revPrompt1 = buildRevisionPrompt(draft1, redTeamFindings1, facts1.warnings, mermaid1.warnings);
      const draft2 = await llmClient.generate(revPrompt1.system, revPrompt1.user);

      if (!draft2) {
        // Fallback to draft1 if revision fails
        console.warn("[WARN] Revision returned empty — using draft 1");
      }

      const currentDraft = draft2 || draft1;

      // Validate draft 2
      const mermaid2 = validateMermaid(currentDraft);
      const facts2 = checkFacts(currentDraft, compact, analysisFiles);

      if (args.verbose) {
        console.log(`  Draft 2: ${currentDraft.split("\n").length} lines, ${mermaid2.warnings.length} mermaid warnings, ${facts2.warnings.length} fact warnings`);
      }

      // ═══════════════════════════════════════════════════════════════
      // PASS 4: Red-team draft 2
      // ═══════════════════════════════════════════════════════════════
      if (!args.quiet) console.log("Pass 4: Red-teaming revised draft...");
      const rtPrompt2 = buildRedTeamPrompt(currentDraft, compact, facts2.warnings, mermaid2.warnings, referenceDoc);
      const redTeamFindings2 = await llmClient.generate(rtPrompt2.system, rtPrompt2.user);

      if (args.verbose) {
        const findingLines2 = redTeamFindings2.split("\n").filter((l) => l.trim()).length;
        console.log(`  Red-team findings (round 2): ${findingLines2} lines`);
      }

      // Check if there are critical/major issues remaining
      const hasCritical = /\bcritical\b/i.test(redTeamFindings2);
      const hasMajor = /\bmajor\b/i.test(redTeamFindings2);

      let finalDraft = currentDraft;

      // ═══════════════════════════════════════════════════════════════
      // PASS 5: Final revise (only if Pass 4 found critical/major issues)
      // ═══════════════════════════════════════════════════════════════
      if (hasCritical || hasMajor) {
        if (!args.quiet) console.log("Pass 5: Final revision (critical/major issues found)...");
        const revPrompt2 = buildRevisionPrompt(currentDraft, redTeamFindings2, facts2.warnings, mermaid2.warnings);
        const draft3 = await llmClient.generate(revPrompt2.system, revPrompt2.user);
        if (draft3) {
          finalDraft = draft3;
        }
      } else {
        if (!args.quiet) console.log("Pass 5: Skipped (no critical/major issues in round 2)");
      }

      // Final validation
      const mermaidFinal = validateMermaid(finalDraft);
      const factsFinal = checkFacts(finalDraft, compact, analysisFiles);

      if (mermaidFinal.warnings.length > 0) {
        for (const w of mermaidFinal.warnings) {
          console.warn(`[MERMAID] ${w}`);
        }
      }
      if (factsFinal.warnings.length > 0) {
        for (const w of factsFinal.warnings) {
          console.warn(`[FACT-CHECK] ${w}`);
        }
      }

      // Write output
      const outputFile = args.outputFile ?? join(fullOutputDir, "TOOLKIT-OVERVIEW-GENERATED.md");
      mkdirSync(dirname(outputFile), { recursive: true });
      writeFileSync(outputFile, finalDraft, "utf-8");

      if (!args.quiet) {
        const passCount = (hasCritical || hasMajor) ? 5 : 4;
        console.log(`Completed ${passCount}-pass synthesis pipeline`);
        console.log(`Wrote synthesized documentation to ${outputFile}`);
        if (mermaidFinal.warnings.length > 0 || factsFinal.warnings.length > 0) {
          console.log(
            `Final warnings: ${mermaidFinal.warnings.length} mermaid, ${factsFinal.warnings.length} fact-check`,
          );
        }
      }
      process.exit(0);
    }
  } catch (err: unknown) {
    const error = err as Error;
    if (error.name === "ConfigError") {
      console.error(`Configuration error: ${error.message}`);
      process.exit(1);
    }
    console.error(`Internal error: ${error.message}`);
    if (args.verbose) {
      console.error(error.stack);
    }
    process.exit(4);
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(4);
});
