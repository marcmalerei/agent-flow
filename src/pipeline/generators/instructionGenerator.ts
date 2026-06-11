import { InstructionNode } from '../types';
import { appendGeneratedMarker, list, mergeMarkdownWithFrontmatter, nodeFileStem, referenceInstructionList, yamlString, yamlStringLine } from './shared';

export function instructionFilePath(node: InstructionNode): string {
  if (node.instructionFile) return node.instructionFile;
  return `.github/instructions/${nodeFileStem(node.id, node.label, 'instruction')}.instructions.md`;
}

export function generateInstructionMarkdown(node: InstructionNode): string {
  const frontmatter = instructionFrontmatter(node);
  if (node.markdown?.trim()) return mergeMarkdownWithFrontmatter(node.markdown, frontmatter);

  return appendGeneratedMarker(`${frontmatter}

# ${node.label}

${node.description ?? ''}

# Referenced instructions

${referenceInstructionList(node.instructionRefs)}

# Rules

${list(node.rules)}
`);
}

function instructionFrontmatter(node: InstructionNode): string {
  return `---
name: ${yamlString(node.label)}
${yamlStringLine('description', node.description)}${yamlStringLine('applyTo', node.applyTo)}
${yamlStringLine('excludeAgent', node.excludeAgent)}---`;
}
