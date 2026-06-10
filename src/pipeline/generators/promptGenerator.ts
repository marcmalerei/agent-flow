import { PromptNode } from '../types';
import { GENERATED_MARKER, ensureTrailingNewline, frontmatterValue, list, yamlList } from './shared';

export function promptFilePath(node: PromptNode): string {
  return node.promptFile ?? `.github/prompts/${node.id}.prompt.md`;
}

export function generatePromptMarkdown(node: PromptNode): string {
  return ensureTrailingNewline(`${GENERATED_MARKER}
---
description: ${frontmatterValue(node.description ?? node.label)}
${yamlList('tools', node.tools)}
---

# ${node.label}

${node.description ?? ''}

# Start agent

${node.startAgent ? `Start with \`${node.startAgent}\`.` : 'No start agent configured.'}

# Workflow

${list(node.workflow)}

# Constraints and non-goals

${list(node.constraints)}

# Required artifacts

${list(node.requiredArtifacts)}

# Definition of done

${list(node.definitionOfDone)}
`);
}
