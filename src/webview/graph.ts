import { AgentPipeline, ArtifactUsage, PipelineEdgeKind, PipelineNode, ReferenceInstruction } from '../pipeline/types';
import { normalizePipelineAgentReferences, resolveAgentReference, stripYamlQuotes } from '../pipeline/referenceResolver';

export interface VisibleFlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
  style?: Record<string, string | number>;
  data: {
    derivedFrom: 'pipeline.edges' | 'agent.calls' | 'agent.handoffs' | 'prompt.startAgent' | 'agent.inputs' | 'agent.outputs' | 'agent.artifactUsages' | 'prompt.artifactUsages' | 'prompt.requiredArtifacts' | 'agent.instructionRefs' | 'prompt.instructionRefs' | 'agent.hooks' | 'agent.mcpServers';
    kind: PipelineEdgeKind | 'reference';
    artifact?: string;
  };
}

const defaultEdgeStyle = { stroke: 'var(--vscode-editor-foreground)', opacity: 0.7 };
const previewStyle = { ...defaultEdgeStyle, strokeDasharray: '5 5', opacity: 0.75 };
const handoffStyle = { stroke: 'var(--vscode-charts-purple)', strokeDasharray: '3 3', strokeWidth: 2, opacity: 0.95 };
const artifactStyle = { stroke: 'var(--vscode-charts-green)', opacity: 0.85 };
const hookStyle = { stroke: 'var(--vscode-charts-red)', strokeDasharray: '2 4', opacity: 0.85 };
const mcpStyle = { stroke: 'var(--vscode-charts-foreground)', strokeDasharray: '6 2', opacity: 0.85 };
const instructionStyle = { stroke: 'var(--vscode-charts-orange)', strokeDasharray: '4 2', opacity: 0.85 };

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
  const instructionsByTarget = instructionTargets(normalized.nodes);
  const hookNodesByAgent = hookNodesByAgentId(normalized.nodes);
  const mcpNodesByAgent = mcpNodesByAgentId(normalized.nodes);

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

    if (node.type === 'prompt') {
      addArtifactUsageEdges(visible, explicitPairs, node.id, node.artifactUsages, 'prompt.artifactUsages', artifactsByPath);
      for (const artifact of node.requiredArtifacts ?? []) {
        const artifactNodeId = artifactsByPath.get(artifact);
        if (!artifactNodeId) continue;
        addPreviewEdge(visible, explicitPairs, {
          id: `ref:prompt-artifact:${artifactNodeId}:${node.id}`,
          source: artifactNodeId,
          target: node.id,
          label: 'reads',
          animated: true,
          style: artifactStyle,
          data: { derivedFrom: 'prompt.requiredArtifacts', kind: 'reference' }
        });
      }
      addInstructionReferenceEdges(visible, explicitPairs, node.id, node.instructionRefs, 'prompt.instructionRefs', instructionsByTarget);
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

    addArtifactUsageEdges(visible, explicitPairs, node.id, node.artifactUsages, 'agent.artifactUsages', artifactsByPath);

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

    addInstructionReferenceEdges(visible, explicitPairs, node.id, node.instructionRefs, 'agent.instructionRefs', instructionsByTarget);

    for (const hookNode of hookNodesByAgent.get(node.id) ?? []) {
      addPreviewEdge(visible, explicitPairs, { id: `ref:agent.hooks:${node.id}:${hookNode.id}`, source: node.id, target: hookNode.id, label: hookNode.trigger ?? 'hook', style: hookStyle, data: { derivedFrom: 'agent.hooks', kind: 'hook' } });
    }
    for (const mcpNode of mcpNodesByAgent.get(node.id) ?? []) {
      addPreviewEdge(visible, explicitPairs, { id: `ref:agent.mcpServers:${node.id}:${mcpNode.id}`, source: node.id, target: mcpNode.id, label: mcpNode.label, style: mcpStyle, data: { derivedFrom: 'agent.mcpServers', kind: 'mcp-server' } });
    }
  }

  return visible;
}

function addPreviewEdge(
  edges: VisibleFlowEdge[],
  explicitPairs: Set<string>,
  edge: VisibleFlowEdge
): void {
  const key = pairKey(edge.source, edge.target);
  if (explicitPairs.has(key)) return;
  explicitPairs.add(key);
  edges.push({ ...edge, style: edge.style ?? previewStyle });
}

function addArtifactUsageEdges(
  edges: VisibleFlowEdge[],
  explicitPairs: Set<string>,
  nodeId: string,
  usages: ArtifactUsage[] | undefined,
  derivedFrom: 'agent.artifactUsages' | 'prompt.artifactUsages',
  artifactsByPath: Map<string, string>
): void {
  for (const usage of usages ?? []) {
    const artifactNodeId = artifactsByPath.get(usage.path);
    if (!artifactNodeId) continue;
    const writes = usage.action === 'write' || usage.action === 'append';
    addPreviewEdge(edges, explicitPairs, {
      id: `ref:${derivedFrom}:${writes ? nodeId : artifactNodeId}:${writes ? artifactNodeId : nodeId}:${slugPart(usage.action)}`,
      source: writes ? nodeId : artifactNodeId,
      target: writes ? artifactNodeId : nodeId,
      label: artifactEdgeLabel(usage.action),
      animated: true,
      style: artifactStyle,
      data: { derivedFrom, kind: 'reference', artifact: usage.path }
    });
  }
}

function addInstructionReferenceEdges(
  edges: VisibleFlowEdge[],
  explicitPairs: Set<string>,
  nodeId: string,
  refs: ReferenceInstruction[] | undefined,
  derivedFrom: 'agent.instructionRefs' | 'prompt.instructionRefs',
  instructionsByTarget: Map<string, string>
): void {
  for (const ref of refs ?? []) {
    const instructionNodeIds = resolveInstructionTargets(ref.target, instructionsByTarget);
    for (const instructionNodeId of instructionNodeIds) {
      addPreviewEdge(edges, explicitPairs, {
        id: `ref:${derivedFrom}:${instructionNodeId}:${nodeId}`,
        source: instructionNodeId,
        target: nodeId,
        label: 'instructs',
        style: instructionStyle,
        data: { derivedFrom, kind: 'reference' }
      });
    }
  }
}

function instructionTargets(nodes: PipelineNode[]): Map<string, string> {
  const targets = new Map<string, string>();
  for (const node of nodes) {
    if (node.type !== 'instruction') continue;
    targets.set(node.id, node.id);
    targets.set(node.label, node.id);
    targets.set(node.instructionFile ?? `.github/instructions/${node.id}.instructions.md`, node.id);
  }
  return targets;
}

function resolveInstructionTargets(target: string, instructionsByTarget: Map<string, string>): string[] {
  if (!target.includes('*')) return instructionsByTarget.has(target) ? [instructionsByTarget.get(target)!] : [];
  const pattern = new RegExp(`^${target.split('*').map(escapeRegExp).join('.*')}$`);
  return [...new Set([...instructionsByTarget.entries()].filter(([candidate]) => pattern.test(candidate)).map(([, id]) => id))];
}

function hookNodesByAgentId(nodes: PipelineNode[]): Map<string, Array<Extract<PipelineNode, { type: 'hook' }>>> {
  const byOwner = new Map<string, Array<Extract<PipelineNode, { type: 'hook' }>>>();
  for (const node of nodes) {
    if (node.type !== 'hook') continue;
    const owner = node.id.split('-hook-')[0];
    if (!owner) continue;
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), node]);
  }
  return byOwner;
}

function mcpNodesByAgentId(nodes: PipelineNode[]): Map<string, Array<Extract<PipelineNode, { type: 'mcp-server' }>>> {
  const byOwner = new Map<string, Array<Extract<PipelineNode, { type: 'mcp-server' }>>>();
  for (const node of nodes) {
    if (node.type !== 'mcp-server' || !node.ownerAgent) continue;
    byOwner.set(node.ownerAgent, [...(byOwner.get(node.ownerAgent) ?? []), node]);
  }
  return byOwner;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function artifactEdgeLabel(action: string): string {
  if (action === 'write') return 'writes';
  if (action === 'append') return 'appends';
  if (action === 'validate') return 'validates';
  return 'reads';
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
  if (kind === 'hook') return hookStyle;
  if (kind === 'mcp-server') return mcpStyle;
  if (kind === 'artifact') return artifactStyle;
  return defaultEdgeStyle;
}

function slugPart(value: string | undefined): string {
  return stripYamlQuotes(value ?? 'handoff').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'handoff';
}
