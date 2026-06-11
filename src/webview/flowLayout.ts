import { AgentPipeline, PipelineNode, Position } from '../pipeline/types';
import { deriveVisibleFlowEdges } from './graph';

export type FlowLayout = 'vertical' | 'horizontal' | 'typeColumns' | 'compact';

const nodeWidth = 260;
const nodeHeight = 170;
const compactNodeWidth = 245;
const compactNodeHeight = 150;
const compactMaxColumns = 8;
const typeOrder = ['prompt', 'agent', 'gate', 'handoff', 'instruction', 'skill', 'artifact', 'hook', 'mcp-server'];

export function coerceFlowLayout(value: unknown): FlowLayout {
  return value === 'vertical' || value === 'horizontal' || value === 'typeColumns' || value === 'compact' ? value : 'compact';
}

export function layoutFlowNodes(pipeline: AgentPipeline, layout: FlowLayout): Map<string, Position> {
  if (layout === 'typeColumns') return layoutByType(pipeline);
  if (layout === 'compact') return layoutCompactGrid(pipeline);
  return layoutLayered(pipeline, layout);
}

function layoutByType(pipeline: AgentPipeline): Map<string, Position> {
  const groups = groupNodesByType(pipeline.nodes);
  const result = new Map<string, Position>();
  let x = 0;
  for (const type of orderedTypes(groups)) {
    const group = sortNodesForOverview(groups.get(type) ?? [], pipeline);
    const rows = rowsForGroup(group.length);
    group.forEach((node, index) => {
      const localColumn = Math.floor(index / rows);
      const row = index % rows;
      result.set(node.id, { x: x + localColumn * nodeWidth, y: row * nodeHeight });
    });
    x += Math.max(1, Math.ceil(group.length / rows)) * nodeWidth + nodeWidth * 0.35;
  }
  return result;
}

function layoutCompactGrid(pipeline: AgentPipeline): Map<string, Position> {
  const components = connectedComponents(pipeline);
  const result = new Map<string, Position>();
  let shelfX = 0;
  let shelfY = 0;
  let shelfHeight = 0;
  const maxShelfWidth = Math.max(compactNodeWidth * 4, Math.ceil(Math.sqrt(Math.max(1, pipeline.nodes.length))) * compactNodeWidth * 2.4);

  for (const component of components) {
    const columns = Math.min(compactMaxColumns, Math.max(2, Math.ceil(Math.sqrt(component.length * 1.25))));
    const rows = Math.ceil(component.length / columns);
    const width = columns * compactNodeWidth;
    const height = rows * compactNodeHeight;
    if (shelfX > 0 && shelfX + width > maxShelfWidth) {
      shelfX = 0;
      shelfY += shelfHeight + compactNodeHeight * 0.9;
      shelfHeight = 0;
    }

    sortNodesForOverview(component, pipeline).forEach((node, index) => {
      result.set(node.id, {
        x: shelfX + (index % columns) * compactNodeWidth,
        y: shelfY + Math.floor(index / columns) * compactNodeHeight
      });
    });
    shelfX += width + compactNodeWidth * 0.7;
    shelfHeight = Math.max(shelfHeight, height);
  }
  return result;
}

function layoutLayered(pipeline: AgentPipeline, layout: 'vertical' | 'horizontal'): Map<string, Position> {
  const nodeIds = new Set(pipeline.nodes.map((node) => node.id));
  const levels = graphLevels(pipeline);

  const rows = new Map<number, AgentPipeline['nodes']>();
  for (const node of pipeline.nodes) {
    const level = levels.get(node.id) ?? 0;
    const row = rows.get(level) ?? [];
    row.push(node);
    rows.set(level, row);
  }

  const result = new Map<string, Position>();
  [...rows.entries()].sort(([a], [b]) => a - b).forEach(([level, row]) => {
    sortNodesForOverview(row.filter((node) => nodeIds.has(node.id)), pipeline).forEach((node, index) => {
      result.set(node.id, layout === 'vertical'
        ? { x: index * nodeWidth, y: level * nodeHeight }
        : { x: level * nodeWidth, y: index * nodeHeight });
    });
  });
  return result;
}

function graphLevels(pipeline: AgentPipeline): Map<string, number> {
  const nodeIds = new Set(pipeline.nodes.map((node) => node.id));
  const incoming = new Map(pipeline.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of deriveVisibleFlowEdges(pipeline)) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target) || edge.source === edge.target) continue;
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }

  const levels = new Map(pipeline.nodes.map((node) => [node.id, 0]));
  const queue = pipeline.nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0).map((node) => node.id);
  if (queue.length === 0) queue.push(...pipeline.nodes.slice(0, 1).map((node) => node.id));
  const visited = new Set<string>();

  while (queue.length) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const target of outgoing.get(current) ?? []) {
      levels.set(target, Math.max(levels.get(target) ?? 0, (levels.get(current) ?? 0) + 1));
      incoming.set(target, Math.max(0, (incoming.get(target) ?? 0) - 1));
      if ((incoming.get(target) ?? 0) === 0) queue.push(target);
    }
  }

  for (const node of pipeline.nodes) {
    if (!visited.has(node.id)) levels.set(node.id, Math.min(levels.get(node.id) ?? 0, Math.max(0, pipeline.nodes.length - 1)));
  }
  return levels;
}

function connectedComponents(pipeline: AgentPipeline): PipelineNode[][] {
  const nodesById = new Map(pipeline.nodes.map((node) => [node.id, node]));
  const adjacency = new Map(pipeline.nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of deriveVisibleFlowEdges(pipeline)) {
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) continue;
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }

  const components: PipelineNode[][] = [];
  const seen = new Set<string>();
  for (const node of pipeline.nodes) {
    if (seen.has(node.id)) continue;
    const component: PipelineNode[] = [];
    const stack = [node.id];
    seen.add(node.id);
    while (stack.length) {
      const current = stack.pop()!;
      const item = nodesById.get(current);
      if (item) component.push(item);
      for (const next of adjacency.get(current) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    components.push(component);
  }
  return components.sort((a, b) => b.length - a.length || a[0]?.label.localeCompare(b[0]?.label ?? '') || 0);
}

function groupNodesByType(nodes: PipelineNode[]): Map<string, PipelineNode[]> {
  const groups = new Map<string, PipelineNode[]>();
  for (const node of nodes) groups.set(node.type, [...(groups.get(node.type) ?? []), node]);
  return groups;
}

function orderedTypes(groups: Map<string, PipelineNode[]>): string[] {
  return [...typeOrder, ...[...groups.keys()].filter((type) => !typeOrder.includes(type))].filter((type) => groups.has(type));
}

function rowsForGroup(count: number): number {
  if (count <= 0) return 1;
  return Math.min(10, Math.max(3, Math.ceil(Math.sqrt(count * 1.8))));
}

function sortNodesForOverview(nodes: PipelineNode[], pipeline: AgentPipeline): PipelineNode[] {
  const degree = nodeDegrees(pipeline);
  return [...nodes].sort((a, b) => typeRank(a.type) - typeRank(b.type) || (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.label.localeCompare(b.label));
}

function nodeDegrees(pipeline: AgentPipeline): Map<string, number> {
  const degree = new Map(pipeline.nodes.map((node) => [node.id, 0]));
  for (const edge of deriveVisibleFlowEdges(pipeline)) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  return degree;
}

function typeRank(type: string): number {
  const index = typeOrder.indexOf(type);
  return index === -1 ? typeOrder.length : index;
}
