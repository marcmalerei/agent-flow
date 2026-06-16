import type { AgentPipeline, PipelineNode } from '../pipeline/types';

export interface GraphSearchResult {
  label: string;
  match: string;
  nodeId: string;
}

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

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}
