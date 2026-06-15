export interface GraphPoint {
  x: number;
  y: number;
}

export interface GraphGeometryNode {
  id: string;
  position: GraphPoint;
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
export const nativeGraphMinZoom = 0.08;
export const nativeGraphMaxZoom = 1.4;
const graphPadding = 120;

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
  const maxX = Math.max(...nodes.map((node) => node.position.x + graphNodeWidth)) + graphPadding;
  const maxY = Math.max(...nodes.map((node) => node.position.y + graphNodeHeight)) + graphPadding;
  return { x: 0, y: 0, width: Math.max(1, maxX), height: Math.max(1, maxY) };
}

export function edgePathBetweenNodes(source: GraphGeometryNode, target: GraphGeometryNode): { path: string; labelX: number; labelY: number; start: GraphPoint; end: GraphPoint } {
  const sourceCenter = nodeCenter(source);
  const targetCenter = nodeCenter(target);
  const horizontal = Math.abs(targetCenter.x - sourceCenter.x) >= Math.abs(targetCenter.y - sourceCenter.y);
  const start = horizontal
    ? { x: sourceCenter.x <= targetCenter.x ? source.position.x + graphNodeWidth : source.position.x, y: sourceCenter.y }
    : { x: sourceCenter.x, y: sourceCenter.y <= targetCenter.y ? source.position.y + graphNodeHeight : source.position.y };
  const end = horizontal
    ? { x: sourceCenter.x <= targetCenter.x ? target.position.x : target.position.x + graphNodeWidth, y: targetCenter.y }
    : { x: targetCenter.x, y: sourceCenter.y <= targetCenter.y ? target.position.y : target.position.y + graphNodeHeight };
  const distance = horizontal ? Math.abs(end.x - start.x) : Math.abs(end.y - start.y);
  const bend = Math.max(56, distance * 0.42);
  const path = horizontal
    ? `M ${round(start.x)} ${round(start.y)} C ${round(start.x + Math.sign(end.x - start.x || 1) * bend)} ${round(start.y)}, ${round(end.x - Math.sign(end.x - start.x || 1) * bend)} ${round(end.y)}, ${round(end.x)} ${round(end.y)}`
    : `M ${round(start.x)} ${round(start.y)} C ${round(start.x)} ${round(start.y + Math.sign(end.y - start.y || 1) * bend)}, ${round(end.x)} ${round(end.y - Math.sign(end.y - start.y || 1) * bend)}, ${round(end.x)} ${round(end.y)}`;
  return { path, labelX: (start.x + end.x) / 2, labelY: (start.y + end.y) / 2, start, end };
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

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function nodeCenter(node: GraphGeometryNode): GraphPoint {
  return { x: node.position.x + graphNodeWidth / 2, y: node.position.y + graphNodeHeight / 2 };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
