import { InstructionNode } from '../types';
import { GENERATED_MARKER, ensureTrailingNewline, frontmatterValue, list } from './shared';

export function instructionFilePath(node: InstructionNode): string {
  return node.instructionFile ?? `.github/instructions/${node.id}.instructions.md`;
}

export function generateInstructionMarkdown(node: InstructionNode): string {
  return ensureTrailingNewline(`${GENERATED_MARKER}
---
applyTo: "${frontmatterValue(node.applyTo)}"
description: "${frontmatterValue(node.description ?? node.label)}"
---

# ${node.label}

${node.description ?? ''}

# Rules

${list(node.rules)}
`);
}
