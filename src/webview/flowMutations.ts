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

export function deletePipelineNodes(pipeline: AgentPipeline, nodeIds: string[]): AgentPipeline {
  const deleted = new Set(nodeIds);
  const deletedNodes = pipeline.nodes.filter((node) => deleted.has(node.id));
  const deletedArtifactPaths = new Set(deletedNodes.filter((node): node is Extract<PipelineNode, { type: 'artifact' }> => node.type === 'artifact').map((node) => node.path));
  const deletedInstructionTargets = new Set(deletedNodes.filter((node): node is Extract<PipelineNode, { type: 'instruction' }> => node.type === 'instruction').flatMap((node) => [node.id, node.label, node.instructionFile ?? `.github/instructions/${node.id}.instructions.md`]));

  return {
    ...pipeline,
    nodes: pipeline.nodes.filter((node) => !deleted.has(node.id)).map((node) => removeNodeReferences(node, deleted, deletedArtifactPaths, deletedInstructionTargets)),
    edges: pipeline.edges.filter((edge) => !deleted.has(edge.from) && !deleted.has(edge.to))
  };
}

export function deletePipelineEdges(pipeline: AgentPipeline, edgeIds: string[]): AgentPipeline {
  const deleted = new Set(edgeIds);
  const removed = pipeline.edges.filter((edge) => deleted.has(edge.id));
  const nodes = pipeline.nodes.map((node) => removed.reduce((current, edge) => removeEdgeReference(current, edge, pipeline.nodes), node));
  return { ...pipeline, nodes, edges: pipeline.edges.filter((edge) => !deleted.has(edge.id)) };
}

function removeNodeReferences(node: PipelineNode, deletedNodeIds: Set<string>, deletedArtifactPaths: Set<string>, deletedInstructionTargets: Set<string>): PipelineNode {
  if (node.type === 'agent') {
    return {
      ...node,
      calls: node.calls?.filter((id) => !deletedNodeIds.has(id)),
      handoffs: node.handoffs?.filter((handoff) => !deletedNodeIds.has(handoff.agent)),
      inputs: node.inputs?.filter((path) => !deletedArtifactPaths.has(path)),
      outputs: node.outputs?.filter((path) => !deletedArtifactPaths.has(path)),
      artifactUsages: node.artifactUsages?.filter((usage) => !deletedArtifactPaths.has(usage.path)),
      instructionRefs: node.instructionRefs?.filter((ref) => !deletedInstructionTargets.has(ref.target))
    };
  }
  if (node.type === 'prompt') {
    return {
      ...node,
      startAgent: node.startAgent && deletedNodeIds.has(node.startAgent) ? undefined : node.startAgent,
      requiredArtifacts: node.requiredArtifacts?.filter((path) => !deletedArtifactPaths.has(path)),
      artifactUsages: node.artifactUsages?.filter((usage) => !deletedArtifactPaths.has(usage.path)),
      instructionRefs: node.instructionRefs?.filter((ref) => !deletedInstructionTargets.has(ref.target))
    };
  }
  if (node.type === 'instruction') {
    return {
      ...node,
      instructionRefs: node.instructionRefs?.filter((ref) => !deletedInstructionTargets.has(ref.target))
    };
  }
  return node;
}

function removeEdgeReference(node: PipelineNode, edge: PipelineEdge, nodes: PipelineNode[]): PipelineNode {
  const source = nodes.find((item) => item.id === edge.from);
  const target = nodes.find((item) => item.id === edge.to);
  if (node.type === 'agent' && node.id === edge.from && target?.type === 'agent') return { ...node, calls: node.calls?.filter((id) => id !== target.id), handoffs: node.handoffs?.filter((handoff) => handoff.agent !== target.id) };
  if (node.type === 'prompt' && node.id === edge.from && target?.type === 'agent') return { ...node, startAgent: node.startAgent === target.id ? undefined : node.startAgent };
  if (node.type === 'agent' && node.id === edge.from && target?.type === 'artifact') return { ...node, outputs: node.outputs?.filter((path) => path !== target.path), artifactUsages: node.artifactUsages?.filter((usage) => usage.path !== target.path) };
  if (node.type === 'agent' && node.id === edge.to && source?.type === 'artifact') return { ...node, inputs: node.inputs?.filter((path) => path !== source.path), artifactUsages: node.artifactUsages?.filter((usage) => usage.path !== source.path) };
  if (node.type === 'prompt' && node.id === edge.to && source?.type === 'artifact') return { ...node, requiredArtifacts: node.requiredArtifacts?.filter((path) => path !== source.path), artifactUsages: node.artifactUsages?.filter((usage) => usage.path !== source.path) };
  return node;
}
