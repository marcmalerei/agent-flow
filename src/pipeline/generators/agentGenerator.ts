import { AgentNode } from '../types';
import { normalizeToolsForVsCode } from '../toolNormalization';
import { appendGeneratedMarker, isDefaultNewNodePath, list, mergeMarkdownWithFrontmatter, nodeFileStem, yamlBooleanLine, yamlList, yamlString, yamlStringLine } from './shared';

export function agentFilePath(node: AgentNode): string {
  const defaultPath = `.github/agents/${node.id}.agent.md`;
  if (node.agentFile && !isDefaultNewNodePath(node.id, 'agent', node.agentFile, defaultPath)) return node.agentFile;
  return `.github/agents/${nodeFileStem(node.id, node.label, 'agent')}.agent.md`;
}

export function generateAgentMarkdown(node: AgentNode): string {
  const frontmatter = agentFrontmatter(node);
  if (node.markdown?.trim()) return mergeMarkdownWithFrontmatter(node.markdown, frontmatter);

  const content = `${frontmatter}

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

${list(node.commandSafety, (node.tools?.includes('execute') || node.tools?.includes('runCommands')) ? '- Prefer the smallest relevant command and avoid destructive commands.' : 'No command execution expected.')}

# Verification

${list(node.verificationRules)}

# Output

${list((node.outputs ?? []).map((output) => `Write \`${output}\`.`))}
`;
  return appendGeneratedMarker(content);
}

function agentFrontmatter(node: AgentNode): string {
  return `---
name: ${yamlString(node.label)}
description: ${yamlString(node.description ?? node.label)}
${yamlStringLine('argument-hint', node.argumentHint)}${yamlStringLine('model', node.model)}${yamlStringLine('target', node.target)}${yamlBooleanLine('user-invocable', node.userInvocable)}${yamlBooleanLine('disable-model-invocation', node.disableModelInvocation)}${yamlAgentHandoffs(node.handoffs)}
${yamlList('tools', normalizeToolsForVsCode(node.tools))}
${yamlList('agents', node.calls)}
---`;
}

function yamlAgentHandoffs(handoffs: AgentNode['handoffs']): string {
  if (!handoffs || handoffs.length === 0) return '';
  return `handoffs:\n${handoffs.map((handoff) => {
    const lines = [`  - label: ${yamlString(handoff.label)}`, `    agent: ${yamlString(handoff.agent)}`];
    if (handoff.prompt) lines.push(`    prompt: ${yamlString(handoff.prompt)}`);
    if (typeof handoff.send === 'boolean') lines.push(`    send: ${handoff.send}`);
    if (handoff.model) lines.push(`    model: ${yamlString(handoff.model)}`);
    return lines.join('\n');
  }).join('\n')}\n`;
}
