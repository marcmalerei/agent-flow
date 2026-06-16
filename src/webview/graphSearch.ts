import type { AgentPipeline, PipelineNode, PipelineNodeType } from '../pipeline/types';

export interface GraphSearchResult {
  label: string;
  match: string;
  nodeId: string;
}

export interface GraphTypeFilterOption {
  count: number;
  label: string;
  type: PipelineNodeType;
}

export interface GraphRelationshipNode {
  id: string;
  label: string;
  type: PipelineNodeType;
}

export interface ArtifactRelationshipSummary {
  artifactId: string;
  consumers: GraphRelationshipNode[];
  path: string;
  producers: GraphRelationshipNode[];
  referencedBy: GraphRelationshipNode[];
}

export type GraphFocusMode = 'full' | 'selected-neighborhood' | 'active-run' | 'execution-path';

export const graphFocusModes: Array<{ id: GraphFocusMode; label: string; icon: string; description: string }> = [
  { id: 'full', label: 'Full graph', icon: 'screen-full', description: 'Show every node allowed by the current type filters.' },
  { id: 'selected-neighborhood', label: 'Selected neighborhood', icon: 'symbol-interface', description: 'Show the selected node and direct inputs, outputs, handoffs, and references.' },
  { id: 'active-run', label: 'Active run', icon: 'pulse', description: 'Show only nodes touched by the current live or replayed activity.' },
  { id: 'execution-path', label: 'Execution path', icon: 'debug-start', description: 'Show the likely primary path from prompt through agents to produced artifacts.' }
];

const graphTypeOrder: PipelineNodeType[] = ['agent', 'prompt', 'instruction', 'role', 'skill', 'artifact', 'handoff', 'gate', 'hook', 'mcp-server'];
const graphTypeLabels: Record<PipelineNodeType, string> = {
  agent: 'Agents',
  prompt: 'Prompts',
  instruction: 'Instructions',
  role: 'Roles',
  skill: 'Skills',
  artifact: 'Artifacts',
  handoff: 'Handoffs',
  gate: 'Gates',
  hook: 'Hooks',
  'mcp-server': 'MCP servers'
};

export function graphSearchResults(pipeline: AgentPipeline, query: string): GraphSearchResult[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];
  return pipeline.nodes.flatMap((node) => {
    const fields = graphNodeSearchFields(node);
    const match = fields.find((field) => normalizeSearchText(field).includes(normalizedQuery));
    return match ? [{ nodeId: node.id, label: node.label, match }] : [];
  });
}

export function graphNeighborhoodNodeIds(pipeline: AgentPipeline, selectedId: string): string[] {
  if (!pipeline.nodes.some((node) => node.id === selectedId)) return [];
  const related = new Set([selectedId]);
  for (const edge of pipeline.edges) {
    if (edge.from === selectedId) related.add(edge.to);
    if (edge.to === selectedId) related.add(edge.from);
  }
  return pipeline.nodes.filter((node) => related.has(node.id)).map((node) => node.id);
}

export function graphTypeFilterOptions(pipeline: AgentPipeline): GraphTypeFilterOption[] {
  const counts = pipeline.nodes.reduce((map, node) => map.set(node.type, (map.get(node.type) ?? 0) + 1), new Map<PipelineNodeType, number>());
  return graphTypeOrder
    .filter((type) => counts.has(type))
    .map((type) => ({ type, label: graphTypeLabels[type], count: counts.get(type) ?? 0 }));
}

export function visibleGraphNodeIdsForTypes(pipeline: AgentPipeline, selectedTypes: readonly PipelineNodeType[]): string[] {
  const selected = new Set(selectedTypes);
  return pipeline.nodes.filter((node) => selected.has(node.type)).map((node) => node.id);
}

export function visibleGraphNodeIdsForFocus(pipeline: AgentPipeline, mode: GraphFocusMode, selectedId: string, activeNodeIds: readonly string[]): string[] {
  if (mode === 'full') return pipeline.nodes.map((node) => node.id);
  if (mode === 'selected-neighborhood') return graphNeighborhoodNodeIds(pipeline, selectedId);
  if (mode === 'active-run') {
    const active = new Set(activeNodeIds);
    return pipeline.nodes.filter((node) => active.has(node.id)).map((node) => node.id);
  }
  return executionPathNodeIds(pipeline);
}

export function artifactRelationshipSummary(pipeline: AgentPipeline, artifactId: string): ArtifactRelationshipSummary | undefined {
  const artifact = pipeline.nodes.find((node) => node.id === artifactId);
  if (!artifact || artifact.type !== 'artifact') return undefined;
  const producerIds = new Set<string>(artifact.producers ?? []);
  const consumerIds = new Set<string>(artifact.consumers ?? []);
  const referencedIds = new Set<string>();
  for (const edge of pipeline.edges) {
    if (edge.to === artifact.id && edge.kind === 'artifact') producerIds.add(edge.from);
    if (edge.from === artifact.id && edge.kind === 'artifact') consumerIds.add(edge.to);
  }
  for (const node of pipeline.nodes) {
    if (node.id === artifact.id) continue;
    if (nodeUsesArtifactAsProducer(node, artifact.path)) producerIds.add(node.id);
    if (nodeUsesArtifactAsConsumer(node, artifact.path)) consumerIds.add(node.id);
    if (nodeReferencesArtifact(node, artifact.path) && !producerIds.has(node.id) && !consumerIds.has(node.id)) referencedIds.add(node.id);
  }
  return {
    artifactId: artifact.id,
    path: artifact.path,
    producers: relationshipNodes(pipeline, producerIds),
    consumers: relationshipNodes(pipeline, consumerIds),
    referencedBy: relationshipNodes(pipeline, referencedIds)
  };
}

function graphNodeSearchFields(node: PipelineNode): string[] {
  const fields = [node.id, node.label, node.type, node.description];
  if (node.type === 'agent') fields.push(node.agentFile, ...arrayFields(node.tools), ...arrayFields(node.inputs), ...arrayFields(node.outputs), ...artifactUsagePaths(node.artifactUsages));
  if (node.type === 'prompt') fields.push(node.promptFile, ...arrayFields(node.tools), ...arrayFields(node.requiredArtifacts), ...artifactUsagePaths(node.artifactUsages));
  if (node.type === 'instruction') fields.push(node.instructionFile, node.applyTo, ...arrayFields(node.requiredArtifacts), ...artifactUsagePaths(node.artifactUsages));
  if (node.type === 'skill') fields.push(node.skillFile, ...arrayFields(node.requiredArtifacts), ...artifactUsagePaths(node.artifactUsages));
  if (node.type === 'role') fields.push(node.roleFile);
  if (node.type === 'artifact') fields.push(node.path, node.schema, ...arrayFields(node.producers), ...arrayFields(node.consumers));
  if (node.type === 'gate') fields.push(node.condition, node.trueBranch, node.falseBranch, node.errorBranch);
  if (node.type === 'hook') fields.push(node.trigger, node.action, ...arrayFields(node.policy));
  if (node.type === 'handoff') fields.push(node.sourceAgent, node.targetAgent, node.prompt, node.model);
  if (node.type === 'mcp-server') fields.push(node.ownerAgent, node.command, ...(Array.isArray(node.args) ? node.args : [node.args]));
  return fields.filter((field): field is string => Boolean(field?.trim()));
}

function artifactUsagePaths(usages: Array<{ path: string }> | undefined): string[] {
  return usages?.map((usage) => usage.path) ?? [];
}

function arrayFields(values: readonly string[] | undefined): string[] {
  return values ? [...values] : [];
}

function relationshipNodes(pipeline: AgentPipeline, ids: Set<string>): GraphRelationshipNode[] {
  return pipeline.nodes
    .filter((node) => ids.has(node.id))
    .map((node) => ({ id: node.id, label: node.label, type: node.type }));
}

function nodeUsesArtifactAsProducer(node: PipelineNode, path: string): boolean {
  if (node.type === 'agent' && node.outputs?.includes(path)) return true;
  return nodeArtifactUsages(node).some((usage) => usage.path === path && ['write', 'append'].includes(usage.action));
}

function nodeUsesArtifactAsConsumer(node: PipelineNode, path: string): boolean {
  if (node.type === 'agent' && node.inputs?.includes(path)) return true;
  if ((node.type === 'prompt' || node.type === 'instruction' || node.type === 'skill') && node.requiredArtifacts?.includes(path)) return true;
  return nodeArtifactUsages(node).some((usage) => usage.path === path && usage.action === 'read');
}

function nodeReferencesArtifact(node: PipelineNode, path: string): boolean {
  return nodeArtifactUsages(node).some((usage) => usage.path === path);
}

function nodeArtifactUsages(node: PipelineNode): Array<{ path: string; action: string }> {
  if ('artifactUsages' in node && Array.isArray(node.artifactUsages)) return node.artifactUsages;
  return [];
}

function executionPathNodeIds(pipeline: AgentPipeline): string[] {
  const pathKinds = new Set(['flow', 'prompt', 'handoff', 'artifact', 'gate']);
  const adjacency = new Map<string, string[]>();
  for (const edge of pipeline.edges) {
    if (!pathKinds.has(edge.kind)) continue;
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
  }
  const visited = new Set<string>();
  const queue = pipeline.nodes.filter((node) => node.type === 'prompt').map((node) => node.id);
  while (queue.length) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) if (!visited.has(next)) queue.push(next);
  }
  return pipeline.nodes.filter((node) => visited.has(node.id)).map((node) => node.id);
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}
