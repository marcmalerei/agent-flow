import type { AgentPipeline, PipelineNode, PipelineNodeType, ValidationFinding } from '../pipeline/types';
import type { VisibleFlowEdge } from './graph';

export interface GraphSearchMatch {
  nodeId: string;
  label: string;
  reason: string;
}

export interface RelationshipNeighborhood {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
}

export interface GraphRelationshipSummary {
  readsFrom: string[];
  writesTo: string[];
  handsOffTo: string[];
  references: string[];
  referencedBy: string[];
}

export type GraphTypeCounts = Partial<Record<PipelineNodeType, number>>;

export function searchGraphNodes(pipeline: AgentPipeline, findings: readonly ValidationFinding[], query: string): GraphSearchMatch[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const findingsByNode = new Map<string, ValidationFinding[]>();
  for (const finding of findings) {
    if (!finding.nodeId) continue;
    findingsByNode.set(finding.nodeId, [...(findingsByNode.get(finding.nodeId) ?? []), finding]);
  }
  return pipeline.nodes
    .map((node) => matchNode(node, findingsByNode.get(node.id) ?? [], normalized))
    .filter((match): match is GraphSearchMatch => Boolean(match));
}

export function relationshipNeighborhood(selectedId: string | undefined, edges: readonly VisibleFlowEdge[]): RelationshipNeighborhood {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  if (!selectedId) return { nodeIds, edgeIds };
  nodeIds.add(selectedId);
  for (const edge of edges) {
    if (edge.source !== selectedId && edge.target !== selectedId) continue;
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
    edgeIds.add(edge.id);
  }
  return { nodeIds, edgeIds };
}

export function summarizeGraphRelationships(selectedId: string | undefined, pipeline: AgentPipeline, edges: readonly VisibleFlowEdge[]): GraphRelationshipSummary {
  const empty: GraphRelationshipSummary = { readsFrom: [], writesTo: [], handsOffTo: [], references: [], referencedBy: [] };
  if (!selectedId) return empty;
  const labels = new Map(pipeline.nodes.map((node) => [node.id, node.label]));
  for (const edge of edges) {
    if (edge.source !== selectedId && edge.target !== selectedId) continue;
    const sourceLabel = labels.get(edge.source) ?? edge.source;
    const targetLabel = labels.get(edge.target) ?? edge.target;
    if (edge.target === selectedId) {
      if (edge.label === 'reads' || edge.data.derivedFrom.includes('inputs') || edge.data.derivedFrom.includes('requiredArtifacts')) empty.readsFrom.push(sourceLabel);
      else if (isReferenceEdge(edge)) empty.referencedBy.push(sourceLabel);
      else empty.references.push(sourceLabel);
    }
    if (edge.source === selectedId) {
      if (edge.label === 'writes' || edge.data.derivedFrom.includes('outputs')) empty.writesTo.push(targetLabel);
      else if (edge.data.kind === 'handoff' || edge.data.derivedFrom.includes('handoff')) empty.handsOffTo.push(targetLabel);
      else if (isReferenceEdge(edge)) empty.references.push(targetLabel);
      else empty.references.push(targetLabel);
    }
  }
  return {
    readsFrom: uniqueSorted(empty.readsFrom),
    writesTo: uniqueSorted(empty.writesTo),
    handsOffTo: uniqueSorted(empty.handsOffTo),
    references: uniqueSorted(empty.references),
    referencedBy: uniqueSorted(empty.referencedBy)
  };
}

export function countGraphNodeTypes(nodes: readonly PipelineNode[]): GraphTypeCounts {
  const counts: GraphTypeCounts = {};
  for (const node of nodes) counts[node.type] = (counts[node.type] ?? 0) + 1;
  return counts;
}

export function visibleNodeIdsForTypes(nodes: readonly PipelineNode[], hiddenTypes: readonly PipelineNodeType[]): Set<string> {
  const hidden = new Set(hiddenTypes);
  return new Set(nodes.filter((node) => !hidden.has(node.type)).map((node) => node.id));
}

function matchNode(node: PipelineNode, findings: readonly ValidationFinding[], query: string): GraphSearchMatch | undefined {
  const entries = nodeSearchEntries(node, findings);
  const compactQuery = compactSearchText(query);
  const hit = entries.find((entry) => entry.value.toLowerCase().includes(query) || compactSearchText(entry.value).includes(compactQuery));
  return hit ? { nodeId: node.id, label: node.label, reason: hit.reason } : undefined;
}

function nodeSearchEntries(node: PipelineNode, findings: readonly ValidationFinding[]): Array<{ value: string; reason: string }> {
  const entries: Array<{ value: string; reason: string }> = [
    { value: node.label, reason: 'label' },
    { value: node.id, reason: 'id' },
    { value: node.type, reason: 'type' }
  ];
  for (const value of nodePathValues(node)) entries.push({ value, reason: 'path' });
  if ('tools' in node) for (const tool of node.tools ?? []) entries.push({ value: tool, reason: 'tool' });
  for (const finding of findings) {
    entries.push({ value: finding.message, reason: finding.severity });
    entries.push({ value: finding.ruleId, reason: 'finding' });
    if (finding.title) entries.push({ value: finding.title, reason: finding.severity });
  }
  return entries.filter((entry) => entry.value);
}

function nodePathValues(node: PipelineNode): string[] {
  if (node.type === 'agent') return [node.agentFile ?? '', ...(node.inputs ?? []), ...(node.outputs ?? []), ...(node.artifactUsages ?? []).map((usage) => usage.path)];
  if (node.type === 'prompt') return [node.promptFile ?? '', ...(node.requiredArtifacts ?? []), ...(node.artifactUsages ?? []).map((usage) => usage.path)];
  if (node.type === 'instruction') return [node.instructionFile ?? '', ...(node.requiredArtifacts ?? []), ...(node.artifactUsages ?? []).map((usage) => usage.path)];
  if (node.type === 'skill') return [node.skillFile ?? '', ...(node.requiredArtifacts ?? []), ...(node.artifactUsages ?? []).map((usage) => usage.path)];
  if (node.type === 'role') return [node.roleFile ?? ''];
  if (node.type === 'artifact') return [node.path];
  return [];
}

function compactSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isReferenceEdge(edge: VisibleFlowEdge): boolean {
  return edge.data.kind === 'reference'
    || edge.data.derivedFrom.includes('instruction')
    || edge.data.derivedFrom.includes('role')
    || edge.data.derivedFrom.includes('skill');
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
