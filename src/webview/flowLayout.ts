import { AgentPipeline, PipelineNode, Position } from '../pipeline/types';
import { deriveVisibleFlowEdges } from './graph';

export type FlowLayout = 'vertical' | 'horizontal' | 'typeColumns' | 'compact';

const nodeWidth = 260;
const nodeHeight = 170;
const compactNodeWidth = 285;
const compactNodeHeight = 150;
const compactMaxColumns = 8;
const compactLaneGap = 44;
const typeOrder = ['prompt', 'agent', 'role', 'gate', 'handoff', 'instruction', 'skill', 'artifact', 'hook', 'mcp-server'];
const laneOrder = ['entry', 'context', 'workflow', 'artifact', 'control', 'integration'] as const;
export type FlowLayoutLane = typeof laneOrder[number];

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
  let offsetX = 0;
  let offsetY = 0;
  let shelfHeight = 0;
  const maxShelfWidth = compactNodeWidth * 18;
  for (const [index, component] of components.entries()) {
    const anchoredSingleton = singletonPositionHint(component);
    if (anchoredSingleton) {
      result.set(anchoredSingleton.id, anchoredSingleton.position);
      continue;
    }
    const componentPositions = layoutWrappedComponent(pipeline, component);
    const bounds = positionBounds(componentPositions);
    if (index > 0 && offsetX > 0 && offsetX + bounds.width > maxShelfWidth) {
      offsetX = 0;
      offsetY += shelfHeight + compactNodeHeight * 0.9;
      shelfHeight = 0;
    }
    for (const [nodeId, position] of componentPositions) result.set(nodeId, { x: position.x + offsetX, y: position.y + offsetY });
    offsetX += bounds.width + compactNodeWidth * 0.45;
    shelfHeight = Math.max(shelfHeight, bounds.height);
  }
  return result;
}

function singletonPositionHint(component: PipelineNode[]): { id: string; position: Position } | undefined {
  if (component.length !== 1) return undefined;
  const [node] = component;
  return node.position ? { id: node.id, position: node.position } : undefined;
}

function layoutWrappedComponent(pipeline: AgentPipeline, component: PipelineNode[]): Map<string, Position> {
  const levels = graphLevels(pipeline);
  const levelGroups = new Map<string, PipelineNode[]>();
  for (const node of component) {
    const level = levels.get(node.id) ?? 0;
    const key = `${level}:${flowLayoutLane(node.type)}`;
    levelGroups.set(key, [...(levelGroups.get(key) ?? []), node]);
  }

  if (levelGroups.size <= 1 && component.length > 1) return layoutComponentGrid(component, pipeline);

  const result = new Map<string, Position>();
  const orderedGroups = [...levelGroups.entries()]
    .map(([key, nodes]) => {
      const [level, lane] = key.split(':') as [string, FlowLayoutLane];
      return { level: Number(level), lane, nodes };
    })
    .sort((a, b) => a.level - b.level || laneRank(a.lane) - laneRank(b.lane));
  for (const group of orderedGroups) {
    const rowNodes = sortNodesForOverview(group.nodes, pipeline);
    rowNodes.forEach((node, row) => {
      result.set(node.id, {
        x: group.level * compactNodeWidth,
        y: laneRank(group.lane) * (compactNodeHeight + compactLaneGap) + row * compactNodeHeight
      });
    });
  }

  return result;
}

function layoutComponentGrid(component: PipelineNode[], pipeline: AgentPipeline): Map<string, Position> {
  const result = new Map<string, Position>();
  const columns = Math.min(compactMaxColumns, Math.max(2, Math.ceil(Math.sqrt(component.length * 1.25))));
  sortNodesForOverview(component, pipeline).forEach((node, index) => {
    result.set(node.id, {
      x: (index % columns) * compactNodeWidth,
      y: Math.floor(index / columns) * compactNodeHeight
    });
  });
  return result;
}

function positionBounds(positions: Map<string, Position>): { width: number; height: number } {
  if (!positions.size) return { width: 0, height: 0 };
  const values = [...positions.values()];
  const minX = Math.min(...values.map((position) => position.x));
  const maxX = Math.max(...values.map((position) => position.x));
  const minY = Math.min(...values.map((position) => position.y));
  const maxY = Math.max(...values.map((position) => position.y));
  return { width: maxX - minX + compactNodeWidth, height: maxY - minY + compactNodeHeight };
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
  const outgoing = new Map<string, string[]>();
  for (const edge of deriveVisibleFlowEdges(pipeline)) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target) || edge.source === edge.target) continue;
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }

  const incoming = new Map(pipeline.nodes.map((node) => [node.id, 0]));
  for (const targets of outgoing.values()) {
    for (const target of targets) incoming.set(target, (incoming.get(target) ?? 0) + 1);
  }

  const levels = new Map<string, number>();
  const rootCandidates = pipeline.nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0);
  const preferredRoots = rootCandidates.filter((node) => node.type === 'prompt').map((node) => node.id);
  const roots = preferredRoots.length ? preferredRoots : rootCandidates.length ? rootCandidates.map((node) => node.id) : pipeline.nodes.slice(0, 1).map((node) => node.id);

  for (const root of roots) assignShortestLevels(root, 0, outgoing, levels);
  for (const node of pipeline.nodes) {
    if (!levels.has(node.id)) assignShortestLevels(node.id, 0, outgoing, levels, true);
  }
  return levels;
}

function assignShortestLevels(root: string, rootLevel: number, outgoing: Map<string, string[]>, levels: Map<string, number>, preserveExisting = false): void {
  const queue: Array<{ id: string; level: number }> = [{ id: root, level: rootLevel }];
  while (queue.length) {
    const current = queue.shift()!;
    const existing = levels.get(current.id);
    if (preserveExisting && existing !== undefined) continue;
    if (existing !== undefined && existing <= current.level) continue;
    levels.set(current.id, current.level);
    for (const target of outgoing.get(current.id) ?? []) {
      const nextLevel = current.level + 1;
      const targetLevel = levels.get(target);
      if (targetLevel === undefined || nextLevel < targetLevel) {
        queue.push({ id: target, level: nextLevel });
      }
    }
  }
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

export function flowLayoutLane(type: string): FlowLayoutLane {
  if (type === 'prompt') return 'entry';
  if (type === 'agent' || type === 'handoff') return 'workflow';
  if (type === 'gate') return 'control';
  if (type === 'artifact') return 'artifact';
  if (type === 'instruction' || type === 'skill' || type === 'role') return 'context';
  return 'integration';
}

function laneRank(lane: FlowLayoutLane): number {
  const index = laneOrder.indexOf(lane);
  return index === -1 ? laneOrder.length : index;
}
