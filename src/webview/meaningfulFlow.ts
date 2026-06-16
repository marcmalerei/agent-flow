import type { AgentPipeline, PipelineNodeType } from '../pipeline/types';

export const primaryMeaningfulFlowTypes = new Set<PipelineNodeType>(['prompt', 'agent', 'handoff', 'gate']);

export function meaningfulFlowNodeIds(pipeline: AgentPipeline): string[] {
  const primary = pipeline.nodes.filter((node) => primaryMeaningfulFlowTypes.has(node.type)).map((node) => node.id);
  return primary.length ? primary : pipeline.nodes.map((node) => node.id);
}
