import { InstructionNode } from '../types';
import { GENERATED_MARKER, ensureTrailingNewline, isDefaultNewNodePath, list, mergeMarkdownWithFrontmatter, nodeFileStem, yamlString, yamlStringLine } from './shared';

export function instructionFilePath(node: InstructionNode): string {
  const defaultPath = `.github/instructions/${node.id}.instructions.md`;
  if (node.instructionFile && !isDefaultNewNodePath(node.id, 'instruction', node.instructionFile, defaultPath)) return node.instructionFile;
  return `.github/instructions/${nodeFileStem(node.id, node.label, 'instruction')}.instructions.md`;
}

export function generateInstructionMarkdown(node: InstructionNode): string {
  const frontmatter = instructionFrontmatter(node);
  if (node.markdown?.trim()) return mergeMarkdownWithFrontmatter(node.markdown, frontmatter);

  return ensureTrailingNewline(`${GENERATED_MARKER}
${frontmatter}

# ${node.label}

${node.description ?? ''}

# Rules

${list(node.rules)}
`);
}

function instructionFrontmatter(node: InstructionNode): string {
  return `---
name: ${yamlString(node.label)}
description: ${yamlString(node.description ?? node.label)}
applyTo: ${yamlString(node.applyTo)}
${yamlStringLine('excludeAgent', node.excludeAgent)}---`;
}
