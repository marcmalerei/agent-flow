import { PipelineNode } from './types';

export function stripYamlQuotes(value: string): string {
  let current = value.trim();
  for (let index = 0; index < 3; index += 1) {
    const quoted = current.match(/^(?:['"])(.*)(?:['"])$/s);
    if (!quoted) break;
    current = quoted[1].trim();
  }
  return current.replace(/\\(["'])/g, '$1').trim();
}


function agentReferenceName(value: string): string {
  const stripped = stripYamlQuotes(value);
  const pathMatch = stripped.match(/(?:^|\/)([^/]+)\.agent\.md$/);
  return pathMatch ? pathMatch[1] : stripped;
}

export function slugifyAgentReference(value: string): string {
  return agentReferenceName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function resolveAgentReference(reference: string, nodes: PipelineNode[]): string | undefined {
  const normalizedReference = agentReferenceName(reference);
  const slug = slugifyAgentReference(reference);
  const agents = nodes.filter((node) => node.type === 'agent');
  const match = agents.find((node) => {
    const id = stripYamlQuotes(node.id);
    const label = stripYamlQuotes(node.label);
    return id === normalizedReference
      || label === normalizedReference
      || slugifyAgentReference(id) === slug
      || slugifyAgentReference(label) === slug;
  });
  return match?.id;
}

export function normalizeAgentCalls(calls: string[] | undefined, nodes: PipelineNode[]): string[] {
  return [...new Set((calls ?? []).map((call) => resolveAgentReference(call, nodes) ?? stripYamlQuotes(call)).filter(Boolean))];
}

export function normalizePipelineAgentReferences<T extends { nodes: PipelineNode[]; edges: Array<{ from: string; to: string }> }>(pipeline: T): T {
  const nodes = pipeline.nodes.map((node) => {
    if (node.type === 'agent') return { ...node, calls: normalizeAgentCalls(node.calls, pipeline.nodes) };
    if (node.type === 'prompt' && node.startAgent) return { ...node, startAgent: resolveAgentReference(node.startAgent, pipeline.nodes) ?? stripYamlQuotes(node.startAgent) };
    return node;
  }) as PipelineNode[];
  const edges = pipeline.edges.map((edge) => ({
    ...edge,
    from: resolveAgentReference(edge.from, nodes) ?? stripYamlQuotes(edge.from),
    to: resolveAgentReference(edge.to, nodes) ?? stripYamlQuotes(edge.to)
  }));
  return { ...pipeline, nodes, edges };
}
