import type Parser from "web-tree-sitter";
import { dirname } from "path";
import type { Entity, Parameter } from "../../types.js";

/**
 * Walk the CST visiting nodes of a specific type.
 */
export function visitNodes(
  node: Parser.SyntaxNode,
  nodeType: string,
  callback: (node: Parser.SyntaxNode) => void,
): void {
  if (node.type === nodeType) {
    callback(node);
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) visitNodes(child, nodeType, callback);
  }
}

/**
 * Extract all function definitions from a parsed shell script tree.
 */
export function extractFunctions(tree: Parser.Tree, filePath: string): Entity[] {
  const entities: Entity[] = [];
  const root = tree.rootNode;

  visitNodes(root, "function_definition", (node) => {
    const nameNode = node.childForFieldName("name");
    const bodyNode = node.childForFieldName("body");
    if (!nameNode) return;

    const name = nameNode.text;
    const params = bodyNode ? extractPositionalParams(bodyNode) : [];
    const description = extractLeadingComment(node);

    entities.push({
      id: `file:${filePath}#${name}`,
      kind: "function",
      name,
      filePath,
      location: {
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      },
      parameters: params,
      description,
      fanIn: 0,
      fanOut: 0,
      importance: 0,
      layer: 0,
      group: dirname(filePath),
    });
  });

  return entities;
}

/**
 * Extract positional parameters ($1, $2, etc.) from a function body.
 */
export function extractPositionalParams(bodyNode: Parser.SyntaxNode): Parameter[] {
  const params: Parameter[] = [];
  const seen = new Set<string>();

  // Check simple_expansion nodes like $1, $2
  visitNodes(bodyNode, "simple_expansion", (node) => {
    const text = node.text;
    const match = text.match(/^\$(\d+)$/);
    if (match && !seen.has(text)) {
      seen.add(text);
      params.push({ name: text, required: true });
    }
  });

  // Check expansion nodes like ${1}, ${2}
  visitNodes(bodyNode, "expansion", (node) => {
    const text = node.text;
    const match = text.match(/^\$\{(\d+)(?:[:-].*?)?\}$/);
    if (match) {
      const paramName = `$${match[1]}`;
      if (!seen.has(paramName)) {
        seen.add(paramName);
        params.push({ name: paramName, required: true });
      }
    }
  });

  return params.sort((a, b) => {
    const numA = parseInt(a.name.replace(/\$\{?/, ""), 10);
    const numB = parseInt(b.name.replace(/\$\{?/, ""), 10);
    return numA - numB;
  });
}

/**
 * Extract leading comment block above a function definition.
 */
export function extractLeadingComment(node: Parser.SyntaxNode): string | undefined {
  const comments: string[] = [];
  let sibling = node.previousNamedSibling;

  while (sibling && sibling.type === "comment") {
    const text = sibling.text.replace(/^#\s?/, "").trim();
    if (text) comments.unshift(text);
    sibling = sibling.previousNamedSibling;
  }

  return comments.length > 0 ? comments.join(" ") : undefined;
}
