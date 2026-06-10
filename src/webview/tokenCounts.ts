import { AgentPipeline, PipelineNode } from '../pipeline/types';
import { generateFileForNode } from '../pipeline/generators';

export function estimateTokenCount(content: string): number {
  const normalized = content.trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

export function estimateNodeTokenCount(pipeline: AgentPipeline, node: PipelineNode): number {
  const generated = generateFileForNode(pipeline, node.id);
  return estimateTokenCount(generated?.content ?? JSON.stringify(node));
}

export function formatTokenBadge(tokens: number): string {
  if (tokens >= 1000) return `~${(tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1)}k tok`;
  return `~${tokens} tok`;
}
