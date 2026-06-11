import { AgentPipeline, ArtifactAction, ArtifactUsage, PipelineEdge, PipelineNode } from '../pipeline/types';

export function connectPipelineNodes(pipeline: AgentPipeline, sourceId: string, targetId: string): AgentPipeline {
  const source = pipeline.nodes.find((node) => node.id === sourceId);
  const target = pipeline.nodes.find((node) => node.id === targetId);
  if (!source || !target) return pipeline;

  const edge = edgeForConnection(source, target);
  const nodes = pipeline.nodes.map((node) => updateNodeReferences(node, source, target));
  const edges = pipeline.edges.some((item) => item.from === sourceId && item.to === targetId && item.kind === edge.kind)
    ? pipeline.edges
    : [...pipeline.edges, edge];
  return { ...pipeline, nodes, edges };
}

function edgeForConnection(source: PipelineNode, target: PipelineNode): PipelineEdge {
  const kind = source.type === 'prompt' && target.type === 'agent'
    ? 'prompt'
    : source.type === 'artifact' || target.type === 'artifact'
      ? 'artifact'
      : 'flow';
  const id = `${source.id}-${kind}-${target.id}`;
  const artifact = source.type === 'artifact' ? source.path : target.type === 'artifact' ? target.path : undefined;
  return { id, from: source.id, to: target.id, kind, artifact };
}

function updateNodeReferences(node: PipelineNode, source: PipelineNode, target: PipelineNode): PipelineNode {
  if (node.id === source.id && source.type === 'agent' && target.type === 'agent') {
    return { ...source, calls: addUnique(source.calls, target.id) };
  }
  if (node.id === source.id && source.type === 'prompt' && target.type === 'agent') {
    return { ...source, startAgent: target.id };
  }
  if (node.id === source.id && source.type === 'agent' && target.type === 'artifact') {
    return { ...source, outputs: addUnique(source.outputs, target.path), artifactUsages: upsertArtifactUsage(source.artifactUsages, target.path, 'write') };
  }
  if (node.id === target.id && source.type === 'artifact' && target.type === 'agent') {
    return { ...target, inputs: addUnique(target.inputs, source.path), artifactUsages: upsertArtifactUsage(target.artifactUsages, source.path, 'read') };
  }
  if (node.id === source.id && source.type === 'prompt' && target.type === 'artifact') {
    return { ...source, requiredArtifacts: addUnique(source.requiredArtifacts, target.path), artifactUsages: upsertArtifactUsage(source.artifactUsages, target.path, 'read') };
  }
  if (node.id === target.id && source.type === 'artifact' && target.type === 'prompt') {
    return { ...target, requiredArtifacts: addUnique(target.requiredArtifacts, source.path), artifactUsages: upsertArtifactUsage(target.artifactUsages, source.path, 'read') };
  }
  return node;
}

function addUnique(values: string[] | undefined, value: string): string[] {
  return [...new Set([...(values ?? []), value])];
}

function upsertArtifactUsage(usages: ArtifactUsage[] | undefined, path: string, action: ArtifactAction): ArtifactUsage[] {
  const current = usages ?? [];
  if (current.some((usage) => usage.path === path)) return current;
  return [...current, { path, action }];
}
