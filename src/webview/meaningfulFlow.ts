import type { AgentPipeline, PipelineNodeType } from "../pipeline/types";

export const primaryMeaningfulFlowTypes = new Set<PipelineNodeType>([
  "prompt",
  "agent",
  "handoff",
  "gate",
]);

export function meaningfulFlowNodeIds(pipeline: AgentPipeline): string[] {
  const primary = pipeline.nodes
    .filter((node) => primaryMeaningfulFlowTypes.has(node.type))
    .map((node) => node.id);
  return primary.length ? primary : pipeline.nodes.map((node) => node.id);
}

export function initialViewportNodeIds(
  pipeline: AgentPipeline,
  visibleNodeIds: readonly string[],
): string[] {
  const visible = new Set(visibleNodeIds);
  const meaningfulVisible = meaningfulFlowNodeIds(pipeline).filter((nodeId) =>
    visible.has(nodeId),
  );
  if (!meaningfulVisible.length) return [...visibleNodeIds];
  return meaningfulVisible.length === visibleNodeIds.length
    ? [...visibleNodeIds]
    : meaningfulVisible;
}

export function autoFitViewportNodeIds(
  pipeline: AgentPipeline,
  visibleNodeIds: readonly string[],
  preserveMeaningfulOverview: boolean,
): string[] {
  return preserveMeaningfulOverview
    ? initialViewportNodeIds(pipeline, visibleNodeIds)
    : [...visibleNodeIds];
}
