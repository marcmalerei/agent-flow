import { AgentPipeline, PipelineEdge, PipelineNode } from '../pipeline/types';

export interface DuplicateSelectionResult {
  pipeline: AgentPipeline;
  selectedIds: string[];
}

export function duplicatePipelineSelection(pipeline: AgentPipeline, selectedIds: readonly string[], offset = { x: 42, y: 42 }): DuplicateSelectionResult {
  const selected = new Set(selectedIds);
  const sourceNodes = pipeline.nodes.filter((node) => selected.has(node.id));
  if (!sourceNodes.length) return { pipeline, selectedIds: [] };
  const existingIds = new Set(pipeline.nodes.map((node) => node.id));
  const existingPaths = new Set(pipeline.nodes.flatMap(nodeFilePaths));
  const idMap = new Map<string, string>();
  const nodes = sourceNodes.map((node) => {
    const id = uniqueId(`${node.id}-copy`, existingIds);
    idMap.set(node.id, id);
    return duplicateNode(node, id, existingPaths, offset);
  });
  const edges = pipeline.edges
    .filter((edge) => selected.has(edge.from) && selected.has(edge.to))
    .map((edge) => duplicateEdge(edge, idMap, new Set([...pipeline.edges.map((item) => item.id)])))
    .filter((edge): edge is PipelineEdge => Boolean(edge));
  return {
    pipeline: {
      ...pipeline,
      nodes: [...pipeline.nodes, ...nodes],
      edges: [...pipeline.edges, ...edges]
    },
    selectedIds: nodes.map((node) => node.id)
  };
}

function duplicateNode(node: PipelineNode, id: string, existingPaths: Set<string>, offset: { x: number; y: number }): PipelineNode {
  const base = {
    ...node,
    id,
    label: `${node.label} copy`,
    position: node.position ? { x: node.position.x + offset.x, y: node.position.y + offset.y } : undefined
  };
  if (node.type === 'agent') return { ...base, type: 'agent', agentFile: uniqueManagedPath(node.agentFile, `.github/agents/${id}.agent.md`, existingPaths) };
  if (node.type === 'prompt') return { ...base, type: 'prompt', promptFile: uniqueManagedPath(node.promptFile, `.github/prompts/${id}.prompt.md`, existingPaths) };
  if (node.type === 'instruction') return { ...base, type: 'instruction', instructionFile: uniqueManagedPath(node.instructionFile, `.github/instructions/${id}.instructions.md`, existingPaths) };
  if (node.type === 'skill') return { ...base, type: 'skill', skillFile: uniqueManagedPath(node.skillFile, `.github/skills/${id}/SKILL.md`, existingPaths) };
  if (node.type === 'role') return { ...base, type: 'role', roleFile: uniqueManagedPath(node.roleFile, `.github/roles/${id}.md`, existingPaths) };
  if (node.type === 'artifact') return { ...base, type: 'artifact', path: uniqueRequiredManagedPath(`.github/artifacts/${id}.md`, existingPaths) };
  return base as PipelineNode;
}

function duplicateEdge(edge: PipelineEdge, idMap: Map<string, string>, existingIds: Set<string>): PipelineEdge | undefined {
  const from = idMap.get(edge.from);
  const to = idMap.get(edge.to);
  if (!from || !to) return undefined;
  return { ...edge, id: uniqueId(`${from}-${edge.kind}-${to}`, existingIds), from, to };
}

function uniqueId(base: string, existing: Set<string>): string {
  let candidate = slug(base);
  let suffix = 2;
  while (existing.has(candidate)) {
    candidate = `${slug(base)}-${suffix}`;
    suffix += 1;
  }
  existing.add(candidate);
  return candidate;
}

function uniqueManagedPath(current: string | undefined, fallback: string, existing: Set<string>): string | undefined {
  const next = uniquePath(fallback || current || 'copy.md', existing);
  existing.add(next);
  return next;
}

function uniqueRequiredManagedPath(fallback: string, existing: Set<string>): string {
  const next = uniquePath(fallback, existing);
  existing.add(next);
  return next;
}

function uniquePath(value: string, existing: Set<string>): string {
  if (!existing.has(value)) return value;
  const match = value.match(/^(.*?)(\.[^/.]+)?$/);
  const stem = match?.[1] ?? value;
  const extension = match?.[2] ?? '';
  let suffix = 2;
  let candidate = `${stem}-${suffix}${extension}`;
  while (existing.has(candidate)) {
    suffix += 1;
    candidate = `${stem}-${suffix}${extension}`;
  }
  return candidate;
}

function nodeFilePaths(node: PipelineNode): string[] {
  if (node.type === 'agent') return [node.agentFile].filter(Boolean) as string[];
  if (node.type === 'prompt') return [node.promptFile].filter(Boolean) as string[];
  if (node.type === 'instruction') return [node.instructionFile].filter(Boolean) as string[];
  if (node.type === 'skill') return [node.skillFile].filter(Boolean) as string[];
  if (node.type === 'role') return [node.roleFile].filter(Boolean) as string[];
  if (node.type === 'artifact') return [node.path];
  return [];
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'node';
}
