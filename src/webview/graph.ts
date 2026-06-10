import { AgentPipeline, PipelineEdgeKind } from '../pipeline/types';
import { normalizePipelineAgentReferences } from '../pipeline/referenceResolver';

export interface VisibleFlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
  style?: Record<string, string | number>;
  data: {
    derivedFrom: 'pipeline.edges' | 'agent.calls' | 'prompt.startAgent' | 'agent.inputs' | 'agent.outputs';
    kind: PipelineEdgeKind | 'reference';
    artifact?: string;
  };
}

const previewStyle = { strokeDasharray: '5 5', opacity: 0.8 };

export function deriveVisibleFlowEdges(pipeline: AgentPipeline): VisibleFlowEdge[] {
  const normalized = normalizePipelineAgentReferences(pipeline);
  const nodesById = new Map(normalized.nodes.map((node) => [node.id, node]));
  const nodeIds = new Set(nodesById.keys());
  const explicitPairs = new Set<string>();
  const visible: VisibleFlowEdge[] = [];

  for (const edge of normalized.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
    if (!isStoredEdgeVisible(edge.from, edge.to, nodesById)) continue;
    explicitPairs.add(pairKey(edge.from, edge.to));
    visible.push({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      label: edge.label ?? edge.artifact ?? edge.kind,
      animated: edge.kind === 'artifact',
      data: { derivedFrom: 'pipeline.edges', kind: edge.kind, artifact: edge.artifact }
    });
  }

  const artifactsByPath = new Map(
    normalized.nodes
      .filter((node) => node.type === 'artifact')
      .map((node) => [node.path, node.id])
  );

  for (const node of normalized.nodes) {
    if (node.type === 'prompt' && node.startAgent && nodeIds.has(node.startAgent)) {
      addPreviewEdge(visible, explicitPairs, {
        id: `ref:prompt:${node.id}:startAgent:${node.startAgent}`,
        source: node.id,
        target: node.startAgent,
        label: 'starts',
        data: { derivedFrom: 'prompt.startAgent', kind: 'reference' }
      });
    }

    if (node.type !== 'agent') continue;

    for (const call of node.calls ?? []) {
      if (!nodeIds.has(call)) continue;
      addPreviewEdge(visible, explicitPairs, {
        id: `ref:agent:${node.id}:calls:${call}`,
        source: node.id,
        target: call,
        label: 'calls',
        data: { derivedFrom: 'agent.calls', kind: 'reference' }
      });
    }

    for (const artifact of node.outputs ?? []) {
      const artifactNodeId = artifactsByPath.get(artifact);
      if (!artifactNodeId) continue;
      addPreviewEdge(visible, explicitPairs, {
        id: `ref:artifact-output:${node.id}:${artifactNodeId}`,
        source: node.id,
        target: artifactNodeId,
        label: 'writes',
        animated: true,
        data: { derivedFrom: 'agent.outputs', kind: 'reference' }
      });
    }

    for (const artifact of node.inputs ?? []) {
      const artifactNodeId = artifactsByPath.get(artifact);
      if (!artifactNodeId) continue;
      addPreviewEdge(visible, explicitPairs, {
        id: `ref:artifact-input:${artifactNodeId}:${node.id}`,
        source: artifactNodeId,
        target: node.id,
        label: 'reads',
        animated: true,
        data: { derivedFrom: 'agent.inputs', kind: 'reference' }
      });
    }
  }

  return visible;
}

function addPreviewEdge(
  edges: VisibleFlowEdge[],
  explicitPairs: Set<string>,
  edge: Omit<VisibleFlowEdge, 'style'>
): void {
  if (explicitPairs.has(pairKey(edge.source, edge.target))) return;
  edges.push({ ...edge, style: previewStyle });
}

function pairKey(source: string, target: string): string {
  return `${source}\u0000${target}`;
}

function isStoredEdgeVisible(source: string, target: string, nodesById: Map<string, AgentPipeline['nodes'][number]>): boolean {
  const sourceNode = nodesById.get(source);
  const targetNode = nodesById.get(target);
  if (sourceNode?.type === 'agent' && targetNode?.type === 'agent') return (sourceNode.calls ?? []).includes(target);
  if (sourceNode?.type === 'prompt' && targetNode?.type === 'agent') return sourceNode.startAgent === target;
  if (sourceNode?.type === 'agent' && targetNode?.type === 'artifact') return (sourceNode.outputs ?? []).includes(targetNode.path);
  if (sourceNode?.type === 'artifact' && targetNode?.type === 'agent') return (targetNode.inputs ?? []).includes(sourceNode.path);
  return true;
}
