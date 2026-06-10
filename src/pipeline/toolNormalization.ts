import { AgentPipeline, PipelineNode } from './types';

const legacyToolAliases: Record<string, string[]> = {
  codebase: ['search', 'read'],
  searchCodebase: ['search'],
  editFiles: ['edit'],
  runCommands: ['execute'],
  terminal: ['execute']
};

export function normalizeToolsForVsCode(tools: readonly string[] | undefined): string[] | undefined {
  if (!tools) return undefined;
  const normalized = tools.flatMap((tool) => {
    const trimmed = tool.trim();
    return legacyToolAliases[trimmed] ?? [trimmed];
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
