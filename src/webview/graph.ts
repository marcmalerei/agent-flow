import { AgentPipeline, PipelineEdgeKind } from '../pipeline/types';
import { normalizePipelineAgentReferences, resolveAgentReference, stripYamlQuotes } from '../pipeline/referenceResolver';

export interface VisibleFlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
  style?: Record<string, string | number>;
  data: {
    derivedFrom: 'pipeline.edges' | 'agent.calls' | 'agent.handoffs' | 'prompt.startAgent' | 'agent.inputs' | 'agent.outputs';
    kind: PipelineEdgeKind | 'reference';
    artifact?: string;
  };
}

const defaultEdgeStyle = { stroke: 'var(--vscode-editor-foreground)', opacity: 0.7 };
const previewStyle = { ...defaultEdgeStyle, strokeDasharray: '5 5', opacity: 0.75 };
const handoffStyle = { stroke: 'var(--vscode-charts-purple)', strokeDasharray: '3 3', strokeWidth: 2, opacity: 0.95 };
const artifactStyle = { stroke: 'var(--vscode-charts-green)', opacity: 0.85 };

export function deriveVisibleFlowEdges(pipeline: AgentPipeline): VisibleFlowEdge[] {
  const normalized = normalizePipelineAgentReferences(pipeline);
  const nodesById = new Map(normalized.nodes.map((node) => [node.id, node]));
  const nodeIds = new Set(nodesById.keys());
  const explicitPairs = new Set<string>();
  const visible: VisibleFlowEdge[] = [];

  for (const edge of normalized.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
    if (!isStoredEdgeVisible(edge.from, edge.to, nodesById, edge.kind)) continue;
    explicitPairs.add(pairKey(edge.from, edge.to));
    visible.push({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      label: deriveStoredEdgeLabel(edge.label, edge.artifact, edge.kind),
      animated: edge.kind === 'artifact',
      style: edgeStyle(edge.kind),
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

    for (const handoff of node.handoffs ?? []) {
      const target = resolveAgentReference(handoff.agent, normalized.nodes);
      if (!target || !nodeIds.has(target)) continue;
      addPreviewEdge(visible, explicitPairs, {
        id: `ref:agent:${node.id}:handoff:${target}:${slugPart(handoff.label)}`,
        source: node.id,
        target,
        label: handoff.label || 'handoff',
        style: handoffStyle,
        data: { derivedFrom: 'agent.handoffs', kind: 'handoff' }
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
        style: artifactStyle,
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
        style: artifactStyle,
        data: { derivedFrom: 'agent.inputs', kind: 'reference' }
      });
    }
  }

  return visible;
}

function addPreviewEdge(
  edges: VisibleFlowEdge[],
  explicitPairs: Set<string>,
  edge: VisibleFlowEdge
): void {
  if (explicitPairs.has(pairKey(edge.source, edge.target))) return;
  edges.push({ ...edge, style: edge.style ?? previewStyle });
}

function pairKey(source: string, target: string): string {
  return `${source}\u0000${target}`;
}

function deriveStoredEdgeLabel(label: string | undefined, artifact: string | undefined, kind: PipelineEdgeKind): string | undefined {
  if (label) return label;
  if (artifact) return artifact;
  if (kind === 'handoff') return label ?? 'handoff';
  if (kind === 'flow') return undefined;
  return kind;
}

function isStoredEdgeVisible(source: string, target: string, nodesById: Map<string, AgentPipeline['nodes'][number]>, kind: PipelineEdgeKind): boolean {
  if (kind === 'flow') return true;
  const sourceNode = nodesById.get(source);
  const targetNode = nodesById.get(target);
  const nodes = [...nodesById.values()];
  if (sourceNode?.type === 'agent' && targetNode?.type === 'agent' && kind === 'handoff') return (sourceNode.handoffs ?? []).some((handoff) => resolveAgentReference(handoff.agent, nodes) === target);
  if (sourceNode?.type === 'agent' && targetNode?.type === 'agent') return (sourceNode.calls ?? []).includes(target);
  if (sourceNode?.type === 'prompt' && targetNode?.type === 'agent') return sourceNode.startAgent === target;
  if (sourceNode?.type === 'agent' && targetNode?.type === 'artifact') return (sourceNode.outputs ?? []).includes(targetNode.path);
  if (sourceNode?.type === 'artifact' && targetNode?.type === 'agent') return (targetNode.inputs ?? []).includes(sourceNode.path);
  return true;
}

function edgeStyle(kind: PipelineEdgeKind): Record<string, string | number> {
  if (kind === 'handoff') return handoffStyle;
  if (kind === 'artifact') return artifactStyle;
  return defaultEdgeStyle;
}

function slugPart(value: string | undefined): string {
  return stripYamlQuotes(value ?? 'handoff').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'handoff';
}
