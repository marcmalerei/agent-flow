import { InstructionNode } from '../types';
import { normalizeNodeLabel } from '../labels';
import { appendGeneratedMarker, artifactUsageList, list, markdownBody, mergeMarkdownWithFrontmatter, nodeFileStem, referenceInstructionList, replaceMarkdownSection, yamlString, yamlStringLine } from './shared';

export function instructionFilePath(node: InstructionNode): string {
  if (node.instructionFile) return node.instructionFile;
  return `.github/instructions/${nodeFileStem(node.id, node.label, 'instruction')}.instructions.md`;
}

export function generateInstructionMarkdown(node: InstructionNode): string {
  const frontmatter = instructionFrontmatter(node);
  const label = normalizeNodeLabel(node.label, node.id);
  if (node.markdown?.trim()) {
    const body = replaceMarkdownSection(
      replaceMarkdownSection(markdownBody(node.markdown), 'Required artifacts', artifactUsageList(node.artifactUsages, node.requiredArtifacts)),
      'Referenced instructions',
      referenceInstructionList(node.instructionRefs)
    );
    return mergeMarkdownWithFrontmatter(body, frontmatter);
  }

  return appendGeneratedMarker(`${frontmatter}

# ${label}

${node.description ?? ''}

# Referenced instructions

${referenceInstructionList(node.instructionRefs)}

# Required artifacts

${artifactUsageList(node.artifactUsages, node.requiredArtifacts)}

# Rules

${list(node.rules)}
`);
}

function instructionFrontmatter(node: InstructionNode): string {
  const label = normalizeNodeLabel(node.label, node.id);
  return `---
name: ${yamlString(label)}
${yamlStringLine('description', node.description)}${yamlStringLine('applyTo', node.applyTo)}
${yamlStringLine('excludeAgent', node.excludeAgent)}---`;
}
