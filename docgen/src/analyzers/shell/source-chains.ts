import type Parser from "web-tree-sitter";
import type { RawEdge } from "../interface.js";
import { visitNodes } from "./functions.js";

/**
 * Strip surrounding quotes from a string.
 */
export function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Extract source/dot include statements from a parsed shell script.
 * Returns raw edges with unresolved paths.
 */
export function extractSourceEdges(tree: Parser.Tree, filePath: string): RawEdge[] {
  const edges: RawEdge[] = [];
  const root = tree.rootNode;

  visitNodes(root, "command", (node) => {
    // In tree-sitter-bash, command children are: command_name, then arguments
    // command_name node contains the actual command text
    const children = node.namedChildren;
    if (children.length < 2) return;

    const cmdNameNode = children[0];
    const cmdName = cmdNameNode.text;
    if (cmdName !== "source" && cmdName !== ".") return;

    // The argument is the second named child (the path)
    const argNode = children[1];
    if (!argNode) return;

    // Get the full text of the argument, handling string/concatenation nodes
    const rawPath = stripQuotes(argNode.text);

    edges.push({
      sourceFile: filePath,
      targetPath: rawPath,
      kind: "sources",
      line: node.startPosition.row + 1,
    });
  });

  return edges;
}
