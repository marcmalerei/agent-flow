import { AgentPipeline, Position } from '../pipeline/types';
import { deriveVisibleFlowEdges } from './graph';

export type FlowLayout = 'manual' | 'vertical' | 'horizontal' | 'typeColumns';

const nodeWidth = 230;
const nodeHeight = 150;
const typeOrder = ['prompt', 'agent', 'gate', 'instruction', 'skill', 'artifact', 'hook'];

export function coerceFlowLayout(value: unknown): FlowLayout {
  return value === 'vertical' || value === 'horizontal' || value === 'typeColumns' ? value : 'manual';
}

export function layoutFlowNodes(pipeline: AgentPipeline, layout: FlowLayout): Map<string, Position> {
  if (layout === 'manual') return new Map(pipeline.nodes.map((node) => [node.id, node.position ?? { x: 0, y: 0 }]));
  if (layout === 'typeColumns') return layoutByType(pipeline);
  return layoutLayered(pipeline, layout);
}

function layoutByType(pipeline: AgentPipeline): Map<string, Position> {
  const groups = new Map<string, AgentPipeline['nodes']>();
  for (const node of pipeline.nodes) {
    const group = groups.get(node.type) ?? [];
    group.push(node);
    groups.set(node.type, group);
  }

  const result = new Map<string, Position>();
  const orderedTypes = [...typeOrder, ...[...groups.keys()].filter((type) => !typeOrder.includes(type))];
  orderedTypes.forEach((type, column) => {
    const group = groups.get(type) ?? [];
    group.sort((a, b) => a.label.localeCompare(b.label));
    group.forEach((node, row) => result.set(node.id, { x: column * nodeWidth, y: row * nodeHeight }));
  });
  return result;
}

function layoutLayered(pipeline: AgentPipeline, layout: 'vertical' | 'horizontal'): Map<string, Position> {
  const nodeIds = new Set(pipeline.nodes.map((node) => node.id));
  const levels = new Map(pipeline.nodes.map((node) => [node.id, 0]));
  const edges = deriveVisibleFlowEdges(pipeline).filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));

  for (let iteration = 0; iteration < pipeline.nodes.length; iteration += 1) {
    let changed = false;
    for (const edge of edges) {
      const next = (levels.get(edge.source) ?? 0) + 1;
      if (next > (levels.get(edge.target) ?? 0)) {
        levels.set(edge.target, Math.min(next, pipeline.nodes.length));
        changed = true;
      }
    }
    if (!changed) break;
  }

  const rows = new Map<number, AgentPipeline['nodes']>();
  for (const node of pipeline.nodes) {
    const level = levels.get(node.id) ?? 0;
    const row = rows.get(level) ?? [];
    row.push(node);
    rows.set(level, row);
  }

  const result = new Map<string, Position>();
  [...rows.entries()].sort(([a], [b]) => a - b).forEach(([level, row]) => {
    row.sort((a, b) => a.label.localeCompare(b.label));
    row.forEach((node, index) => {
      result.set(node.id, layout === 'vertical'
        ? { x: index * nodeWidth, y: level * nodeHeight }
        : { x: level * nodeWidth, y: index * nodeHeight });
    });
  });
  return result;
}
