import { PromptNode } from '../types';
import { normalizeToolsForVsCode } from '../toolNormalization';
import { appendGeneratedMarker, artifactUsageList, isDefaultNewNodePath, list, mergeMarkdownWithFrontmatter, nodeFileStem, referenceInstructionList, yamlList, yamlString, yamlStringLine } from './shared';

export function promptFilePath(node: PromptNode): string {
  const defaultPath = `.github/prompts/${node.id}.prompt.md`;
  if (node.promptFile && !isDefaultNewNodePath(node.id, 'prompt', node.promptFile, defaultPath)) return node.promptFile;
  return `.github/prompts/${nodeFileStem(node.id, node.label, 'prompt')}.prompt.md`;
}

export function generatePromptMarkdown(node: PromptNode): string {
  const frontmatter = promptFrontmatter(node);
  if (node.markdown?.trim()) return mergeMarkdownWithFrontmatter(node.markdown, frontmatter);

  return appendGeneratedMarker(`${frontmatter}

# ${node.label}

${node.description ?? ''}

# Start agent

${node.startAgent ? `Start with \`${node.startAgent}\`.` : 'No start agent configured.'}

# Workflow

${list(node.workflow)}

# Constraints and non-goals

${list(node.constraints)}

# Required artifacts

${artifactUsageList(node.artifactUsages, node.requiredArtifacts)}

# Referenced instructions

${referenceInstructionList(node.instructionRefs)}

# Definition of done

${list(node.definitionOfDone)}
`);
}

function promptFrontmatter(node: PromptNode): string {
  return `---
name: ${yamlString(node.label)}
description: ${yamlString(node.description ?? node.label)}
${yamlStringLine('argument-hint', node.argumentHint)}${yamlStringLine('agent', node.startAgent)}${yamlStringLine('model', node.model)}
${yamlList('tools', normalizeToolsForVsCode(node.tools))}
---`;
}
