import type { AgentPipeline } from '../pipeline/types';

export function graphNodeIdForSelection(pipeline: AgentPipeline, nodeId: string): string {
  const node = pipeline.nodes.find((item) => item.id === nodeId);
  if (!node || node.type !== 'handoff') return nodeId;
  const sourceAgent = node.sourceAgent ? pipeline.nodes.find((item) => item.id === node.sourceAgent && item.type === 'agent') : undefined;
  return sourceAgent?.id ?? nodeId;
}
