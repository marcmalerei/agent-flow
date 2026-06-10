import { AgentNode } from '../types';
import { GENERATED_MARKER, ensureTrailingNewline, frontmatterValue, list, yamlList } from './shared';

export function agentFilePath(node: AgentNode): string {
  return node.agentFile ?? `.github/agents/${node.id}.agent.md`;
}

export function generateAgentMarkdown(node: AgentNode): string {
  const content = `${GENERATED_MARKER}
---
name: ${frontmatterValue(node.label)}
description: ${frontmatterValue(node.description ?? node.label)}
${yamlList('tools', node.tools)}
${yamlList('agents', node.calls)}
---

# Role

${node.description ?? `You are responsible for ${node.label}.`}

# Required input

${list((node.inputs ?? []).map((input) => `Read \`${input}\` first.`))}

# Context budget

${list(node.contextBudget)}

# Scope rules

${list(node.rules)}

# Edit rules

${list(node.editRules)}

# Allowed skills

${list(node.allowedSkills)}

# Forbidden changes

${list(node.forbiddenChanges)}

# Command safety

${list(node.commandSafety, node.tools?.includes('runCommands') ? '- Prefer the smallest relevant command and avoid destructive commands.' : 'No command execution expected.')}

# Verification

${list(node.verificationRules)}

# Output

${list((node.outputs ?? []).map((output) => `Write \`${output}\`.`))}
`;
  return ensureTrailingNewline(content);
}
