import { AgentNode } from '../types';
import { normalizeToolsForVsCode } from '../toolNormalization';
import { appendGeneratedMarker, artifactUsageList, isDefaultNewNodePath, list, mergeMarkdownWithFrontmatter, nodeFileStem, referenceInstructionList, yamlBooleanLine, yamlList, yamlString, yamlStringLine } from './shared';

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

# Artifact work

${artifactUsageList(node.artifactUsages)}

# Referenced instructions

${referenceInstructionList(node.instructionRefs)}

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
${yamlStringLine('argument-hint', node.argumentHint)}${yamlStringLine('model', node.model)}${yamlStringLine('target', node.target)}${yamlBooleanLine('user-invocable', node.userInvocable)}${yamlBooleanLine('disable-model-invocation', node.disableModelInvocation)}${yamlAgentHandoffs(node.handoffs)}${yamlAgentHooks(node.hooks)}${yamlMcpServers(node.mcpServers)}
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


function yamlAgentHooks(hooks: AgentNode['hooks']): string {
  if (!hooks || Object.keys(hooks).length === 0) return '';
  const lines = ['hooks:'];
  for (const [trigger, commands] of Object.entries(hooks)) {
    lines.push(`  ${trigger}:`);
    for (const command of commands) {
      const entries = Object.entries(command).filter(([, value]) => value !== undefined);
      if (entries.length === 0) continue;
      const [firstKey, firstValue] = entries[0];
      lines.push(`    - ${firstKey}: ${yamlHookValue(firstValue)}`);
      for (const [key, value] of entries.slice(1)) lines.push(`      ${key}: ${yamlHookValue(value)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function yamlMcpServers(servers: AgentNode['mcpServers']): string {
  if (!servers || servers.length === 0) return '';
  return `mcp-servers:\n${servers.map((server) => {
    const lines = [`  - name: ${yamlString(server.name)}`];
    for (const [key, value] of Object.entries(server)) {
      if (key === 'name' || value === undefined) continue;
      lines.push(`    ${key}: ${Array.isArray(value) ? JSON.stringify(value) : yamlHookValue(value)}`);
    }
    return lines.join('\n');
  }).join('\n')}\n`;
}

function yamlHookValue(value: string | boolean | number | string[] | undefined): string {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return JSON.stringify(value);
  return yamlString(String(value ?? ''));
}
