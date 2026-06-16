export interface GraphPoint {
  x: number;
  y: number;
}

export interface GraphGeometryNode {
  id: string;
  position: GraphPoint;
  width?: number;
  height?: number;
}

export interface GraphViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface GraphBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphCanvasSize {
  width: number;
  height: number;
}

export const graphNodeWidth = 190;
export const graphNodeHeight = 96;
export const handoffNodeWidth = 158;
export const handoffNodeHeight = 72;
export const nativeGraphMinZoom = 0.08;
export const nativeGraphMaxZoom = 1.4;
const graphPadding = 120;
const defaultEdgeLabelWidth = 56;
const defaultEdgeLabelHeight = 20;
const edgeLabelGap = 12;

export function normalizeGraphNodePositions<T extends GraphGeometryNode>(nodes: readonly T[]): { nodes: T[]; bounds: GraphBounds } {
  if (!nodes.length) return { nodes: [], bounds: { x: 0, y: 0, width: 240, height: 240 } };
  const rawMinX = Math.min(...nodes.map((node) => node.position.x));
  const rawMinY = Math.min(...nodes.map((node) => node.position.y));
  const offsetX = graphPadding - rawMinX;
  const offsetY = graphPadding - rawMinY;
  const normalized = nodes.map((node) => ({ ...node, position: { x: node.position.x + offsetX, y: node.position.y + offsetY } }));
  return { nodes: normalized, bounds: measuredGraphBounds(normalized) };
}

export function measuredGraphBounds(nodes: readonly GraphGeometryNode[]): GraphBounds {
  if (!nodes.length) return { x: 0, y: 0, width: 240, height: 240 };
  const maxX = Math.max(...nodes.map((node) => node.position.x + nodeWidth(node))) + graphPadding;
  const maxY = Math.max(...nodes.map((node) => node.position.y + nodeHeight(node))) + graphPadding;
  return { x: 0, y: 0, width: Math.max(1, maxX), height: Math.max(1, maxY) };
}

export function edgePathBetweenNodes(source: GraphGeometryNode, target: GraphGeometryNode, labelOptions: { labelWidth?: number; labelHeight?: number } = {}): { path: string; labelX: number; labelY: number; start: GraphPoint; end: GraphPoint } {
  const sourceCenter = nodeCenter(source);
  const targetCenter = nodeCenter(target);
  const horizontal = Math.abs(targetCenter.x - sourceCenter.x) >= Math.abs(targetCenter.y - sourceCenter.y);
  const start = horizontal
    ? { x: sourceCenter.x <= targetCenter.x ? source.position.x + nodeWidth(source) : source.position.x, y: sourceCenter.y }
    : { x: sourceCenter.x, y: sourceCenter.y <= targetCenter.y ? source.position.y + nodeHeight(source) : source.position.y };
  const end = horizontal
    ? { x: sourceCenter.x <= targetCenter.x ? target.position.x : target.position.x + nodeWidth(target), y: targetCenter.y }
    : { x: targetCenter.x, y: sourceCenter.y <= targetCenter.y ? target.position.y : target.position.y + nodeHeight(target) };
  const distance = horizontal ? Math.abs(end.x - start.x) : Math.abs(end.y - start.y);
  const bend = Math.max(56, distance * 0.42);
  const path = horizontal
    ? `M ${round(start.x)} ${round(start.y)} C ${round(start.x + Math.sign(end.x - start.x || 1) * bend)} ${round(start.y)}, ${round(end.x - Math.sign(end.x - start.x || 1) * bend)} ${round(end.y)}, ${round(end.x)} ${round(end.y)}`
    : `M ${round(start.x)} ${round(start.y)} C ${round(start.x)} ${round(start.y + Math.sign(end.y - start.y || 1) * bend)}, ${round(end.x)} ${round(end.y - Math.sign(end.y - start.y || 1) * bend)}, ${round(end.x)} ${round(end.y)}`;
  const label = edgeLabelPosition(source, target, start, end, horizontal, labelOptions);
  return { path, labelX: label.x, labelY: label.y, start, end };
}

export function fitNativeGraphViewport(bounds: GraphBounds, size: GraphCanvasSize): GraphViewport {
  const padding = 56;
  const availableWidth = Math.max(40, size.width - padding * 2);
  const availableHeight = Math.max(40, size.height - padding * 2);
  const zoom = clamp(Math.min(1, availableWidth / bounds.width, availableHeight / bounds.height), nativeGraphMinZoom, 1);
  return {
    x: (size.width - bounds.width * zoom) / 2,
    y: (size.height - bounds.height * zoom) / 2,
    zoom
  };
}

export function focusViewportOnNode(node: GraphGeometryNode, current: GraphViewport, size: GraphCanvasSize): GraphViewport {
  const center = nodeCenter(node);
  return {
    x: size.width / 2 - center.x * current.zoom,
    y: size.height / 2 - center.y * current.zoom,
    zoom: current.zoom
  };
}

export function findSpatialNeighborNodeId(nodes: readonly GraphGeometryNode[], selectedId: string, direction: 'left' | 'right' | 'up' | 'down'): string | undefined {
  const selected = nodes.find((node) => node.id === selectedId);
  if (!selected) return undefined;
  const center = nodeCenter(selected);
  const horizontal = direction === 'left' || direction === 'right';
  const sign = direction === 'left' || direction === 'up' ? -1 : 1;
  let best: { id: string; score: number } | undefined;
  for (const node of nodes) {
    if (node.id === selectedId) continue;
    const candidate = nodeCenter(node);
    const primaryDelta = horizontal ? candidate.x - center.x : candidate.y - center.y;
    if (Math.sign(primaryDelta) !== sign) continue;
    const secondaryDelta = horizontal ? candidate.y - center.y : candidate.x - center.x;
    if (Math.abs(primaryDelta) * 1.4 < Math.abs(secondaryDelta)) continue;
    const score = Math.abs(primaryDelta) + Math.abs(secondaryDelta) * 4;
    if (!best || score < best.score) best = { id: node.id, score };
  }
  return best?.id;
}

export function shouldAutoFitGraph({ previousSignature, nextSignature, userInteracted, reason }: { previousSignature?: string; nextSignature: string; userInteracted: boolean; reason: 'activity' | 'resize' | 'structure' }): boolean {
  if (previousSignature !== nextSignature) return true;
  if (reason === 'activity') return false;
  return !userInteracted;
}

export function screenToGraphPosition(point: GraphPoint, rect: GraphCanvasSize & { left: number; top: number }, viewport: GraphViewport): GraphPoint {
  return { x: (point.x - rect.left - viewport.x) / viewport.zoom, y: (point.y - rect.top - viewport.y) / viewport.zoom };
}

export function graphTransform(viewport: GraphViewport): string {
  return `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;
}

export function graphNodeSizeForType(type: string): { width: number; height: number } {
  return type === 'handoff'
    ? { width: handoffNodeWidth, height: handoffNodeHeight }
    : { width: graphNodeWidth, height: graphNodeHeight };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function nodeCenter(node: GraphGeometryNode): GraphPoint {
  return { x: node.position.x + nodeWidth(node) / 2, y: node.position.y + nodeHeight(node) / 2 };
}

function edgeLabelPosition(source: GraphGeometryNode, target: GraphGeometryNode, start: GraphPoint, end: GraphPoint, horizontal: boolean, options: { labelWidth?: number; labelHeight?: number }): GraphPoint {
  const width = options.labelWidth ?? defaultEdgeLabelWidth;
  const height = options.labelHeight ?? defaultEdgeLabelHeight;
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const nodes = [source, target];
  if (!labelOverlapsNodes(midpoint, width, height, nodes)) return midpoint;

  if (horizontal) {
    const top = Math.min(source.position.y, target.position.y);
    const bottom = Math.max(source.position.y + nodeHeight(source), target.position.y + nodeHeight(target));
    const above = { x: midpoint.x, y: top - height / 2 - edgeLabelGap };
    if (!labelOverlapsNodes(above, width, height, nodes)) return above;
    return { x: midpoint.x, y: bottom + height / 2 + edgeLabelGap };
  }

  const left = Math.min(source.position.x, target.position.x);
  const right = Math.max(source.position.x + nodeWidth(source), target.position.x + nodeWidth(target));
  const before = { x: left - width / 2 - edgeLabelGap, y: midpoint.y };
  if (!labelOverlapsNodes(before, width, height, nodes)) return before;
  return { x: right + width / 2 + edgeLabelGap, y: midpoint.y };
}

function labelOverlapsNodes(center: GraphPoint, width: number, height: number, nodes: readonly GraphGeometryNode[]): boolean {
  const label = {
    left: center.x - width / 2,
    right: center.x + width / 2,
    top: center.y - height / 2,
    bottom: center.y + height / 2
  };
  return nodes.some((node) => rectsOverlap(label, {
    left: node.position.x,
    right: node.position.x + nodeWidth(node),
    top: node.position.y,
    bottom: node.position.y + nodeHeight(node)
  }));
}

function nodeWidth(node: GraphGeometryNode): number {
  return node.width ?? graphNodeWidth;
}

function nodeHeight(node: GraphGeometryNode): number {
  return node.height ?? graphNodeHeight;
}

function rectsOverlap(a: { left: number; right: number; top: number; bottom: number }, b: { left: number; right: number; top: number; bottom: number }): boolean {
  return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
