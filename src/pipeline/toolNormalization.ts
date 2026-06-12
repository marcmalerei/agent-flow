import { AgentPipeline, PipelineNode } from './types';

const legacyToolAliases: Record<string, string[]> = {
  codebase: ['search', 'read'],
  searchCodebase: ['search'],
  editFiles: ['edit'],
  runCommands: ['execute'],
  terminal: ['execute']
};

const internalToolPrefixes = ['copilot_'];

export function normalizeToolsForVsCode(tools: readonly string[] | undefined): string[] | undefined {
  if (!tools) return undefined;
  const normalized = tools.flatMap((tool) => {
    const trimmed = tool.trim();
    return legacyToolAliases[trimmed] ?? [publicToolId(trimmed)];
  }).filter(Boolean);
  return [...new Set(normalized)].sort((a, b) => a.localeCompare(b));
}

export function normalizePipelineTools<T extends AgentPipeline>(pipeline: T): T {
  const nodes = pipeline.nodes.map((node) => {
    if ((node.type === 'agent' || node.type === 'prompt') && node.tools) {
      return { ...node, tools: normalizeToolsForVsCode(node.tools) } as PipelineNode;
    }
    return node;
  });
  return { ...pipeline, nodes } as T;
}

function publicToolId(tool: string): string {
  const slash = tool.indexOf('/');
  if (slash >= 0) {
    const group = tool.slice(0, slash).trim();
    const name = stripInternalToolPrefix(tool.slice(slash + 1).trim());
    return group && name ? `${group}/${name}` : tool;
  }
  return stripInternalToolPrefix(tool);
}

function stripInternalToolPrefix(value: string): string {
  return internalToolPrefixes.reduce((current, prefix) => current.startsWith(prefix) ? current.slice(prefix.length) : current, value);
}
