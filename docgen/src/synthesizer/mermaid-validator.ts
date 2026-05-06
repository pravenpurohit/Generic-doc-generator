export interface MermaidValidationResult {
  valid: boolean;
  warnings: string[];
}

/** Valid Mermaid diagram type keywords. */
const VALID_DIAGRAM_TYPES = [
  "graph",
  "flowchart",
  "sequenceDiagram",
  "classDiagram",
  "stateDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "journey",
  "gantt",
  "pie",
  "quadrantChart",
  "requirementDiagram",
  "gitGraph",
  "mindmap",
  "timeline",
  "sankey-beta",
  "xychart-beta",
  "block-beta",
];

/**
 * Extract all ```mermaid blocks from markdown and validate them.
 * Returns warnings but does not block output — diagrams may still render.
 */
export function validateMermaid(markdown: string): MermaidValidationResult {
  const warnings: string[] = [];
  const blocks = extractMermaidBlocks(markdown);

  if (blocks.length === 0) {
    warnings.push("No mermaid blocks found in the generated output");
    return { valid: false, warnings };
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const blockLabel = `Mermaid block ${i + 1}`;

    // Check valid diagram type
    const firstLine = block.trim().split("\n")[0].trim();
    const diagramType = firstLine.split(/\s+/)[0];
    if (!VALID_DIAGRAM_TYPES.includes(diagramType)) {
      warnings.push(`${blockLabel}: Unknown diagram type "${diagramType}"`);
    }

    // Check balanced brackets/braces
    const bracketWarnings = checkBalancedBrackets(block, blockLabel);
    warnings.push(...bracketWarnings);

    // Sequence diagram specific checks
    if (diagramType === "sequenceDiagram") {
      const seqWarnings = checkSequenceDiagram(block, blockLabel);
      warnings.push(...seqWarnings);
    }

    // State diagram specific checks
    if (diagramType === "stateDiagram-v2" || diagramType === "stateDiagram") {
      const stateWarnings = checkStateDiagram(block, blockLabel);
      warnings.push(...stateWarnings);
    }
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}

/**
 * Extract mermaid code blocks from markdown content.
 */
function extractMermaidBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const regex = /```mermaid\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(markdown)) !== null) {
    blocks.push(match[1]);
  }

  return blocks;
}

/**
 * Check that brackets, braces, and parentheses are balanced.
 */
function checkBalancedBrackets(block: string, label: string): string[] {
  const warnings: string[] = [];
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack: string[] = [];

  // Strip quoted strings to avoid false positives
  const stripped = block.replace(/"[^"]*"/g, "").replace(/'[^']*'/g, "");

  for (const char of stripped) {
    if (char in pairs) {
      stack.push(pairs[char]);
    } else if (char === ")" || char === "]" || char === "}") {
      if (stack.length === 0 || stack[stack.length - 1] !== char) {
        warnings.push(`${label}: Unbalanced "${char}" detected`);
        return warnings;
      }
      stack.pop();
    }
  }

  if (stack.length > 0) {
    warnings.push(`${label}: Unclosed bracket(s) detected — expected: ${stack.reverse().join("")}`);
  }

  return warnings;
}

/**
 * Check that sequenceDiagram blocks have participant declarations before messages.
 */
function checkSequenceDiagram(block: string, label: string): string[] {
  const warnings: string[] = [];
  const lines = block.trim().split("\n").slice(1); // skip diagram type line

  let hasParticipant = false;
  let hasMessage = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("participant ") || trimmed.startsWith("actor ")) {
      hasParticipant = true;
    }
    if (trimmed.includes("->>") || trimmed.includes("-->>") || trimmed.includes("--)")) {
      hasMessage = true;
    }
  }

  if (hasMessage && !hasParticipant) {
    warnings.push(`${label}: sequenceDiagram has messages but no participant declarations`);
  }

  return warnings;
}

/**
 * Check that stateDiagram-v2 state names don't contain spaces or special chars.
 */
function checkStateDiagram(block: string, label: string): string[] {
  const warnings: string[] = [];
  const lines = block.trim().split("\n").slice(1); // skip diagram type line

  for (const line of lines) {
    const trimmed = line.trim();

    // Match state declarations: state "Label" as StateName
    const stateMatch = trimmed.match(/^state\s+"[^"]*"\s+as\s+(\S+)/);
    if (stateMatch) {
      const stateName = stateMatch[1];
      if (/[^a-zA-Z0-9_]/.test(stateName)) {
        warnings.push(`${label}: State name "${stateName}" contains special characters`);
      }
    }

    // Match inline state names in transitions: StateName --> OtherState
    const transitionMatch = trimmed.match(/^(\w+)\s*-->/);
    if (transitionMatch) {
      const stateName = transitionMatch[1];
      if (/\s/.test(stateName)) {
        warnings.push(`${label}: State name "${stateName}" contains spaces`);
      }
    }
  }

  return warnings;
}
