import { describe, expect, it } from 'vitest';
import {
  edgePathBetweenNodes,
  findSpatialNeighborNodeId,
  fitAutoGraphViewport,
  fitGraphNodesViewport,
  fitNativeGraphViewport,
  focusViewportOnNode,
  graphNodeHeight,
  graphNodeSizeForType,
  graphNodeWidth,
  graphOverviewMetrics,
  measuredGraphBounds,
  normalizeGraphNodePositions,
  shouldAutoFitGraph,
  type GraphGeometryNode,
  type GraphViewport,
} from '../src/webview/graphGeometry';

const source: GraphGeometryNode = { id: 'source', position: { x: 0, y: 40 } };
const target: GraphGeometryNode = { id: 'target', position: { x: 320, y: 40 } };

describe('native graph geometry', () => {
  it('anchors horizontal edges exactly on visible source target ports', () => {
    const edge = edgePathBetweenNodes(source, target);
    expect(edge.start).toEqual({ x: 195, y: 88 });
    expect(edge.end).toEqual({ x: 315, y: 88 });
    expect(edge.path.startsWith('M 195 88 ')).toBe(true);
    expect(edge.path.endsWith(' 315 88')).toBe(true);
  });

  it('places short edge labels outside source target node bounds', () => {
    const closeSource: GraphGeometryNode = { id: 'source', position: { x: 0, y: 40 } };
    const closeTarget: GraphGeometryNode = { id: 'target', position: { x: 210, y: 40 } };
    const edge = edgePathBetweenNodes(closeSource, closeTarget, { labelWidth: 132, labelHeight: 22 });
    expect(labelIntersectsNode(edge, closeSource, 132, 22)).toBe(false);
    expect(labelIntersectsNode(edge, closeTarget, 132, 22)).toBe(false);
    expect(edge.labelY).toBeLessThan(closeSource.position.y);
  });

  it('uses full-size handoff node dimensions aligned bounds edge anchors', () => {
    const handoffSize = graphNodeSizeForType('handoff');
    expect(handoffSize).toEqual({ width: graphNodeWidth, height: graphNodeHeight });

    const handoff: GraphGeometryNode = { id: 'handoff', position: { x: 0, y: 0 } };
    const handoffTarget: GraphGeometryNode = { id: 'agent', position: { x: 320, y: 0 } };
    const edge = edgePathBetweenNodes(handoff, handoffTarget);

    expect(edge.start).toEqual({ x: 195, y: 48 });
    expect(edge.end).toEqual({ x: 315, y: 48 });
  });

  it('normalizes graph node positions into positive padded coordinates', () => {
    const normalized = normalizeGraphNodePositions([
      { id: 'a', position: { x: -120, y: -40 } },
      { id: 'b', position: { x: 240, y: 180 } },
    ]);

    expect(normalized.nodes[0]?.position.x).toBeGreaterThanOrEqual(120);
    expect(normalized.nodes[0]?.position.y).toBeGreaterThanOrEqual(120);
    expect(normalized.bounds.width).toBeGreaterThan(0);
    expect(normalized.bounds.height).toBeGreaterThan(0);
  });

  it('keeps manual zoom stable during activity updates but auto-fits structural graph changes', () => {
    expect(
      shouldAutoFitGraph({
        previousSignature: 'a|b',
        nextSignature: 'a|b',
        userInteracted: true,
        reason: 'activity',
      }),
    ).toBe(false);
    expect(
      shouldAutoFitGraph({
        previousSignature: 'a|b',
        nextSignature: 'a|b|c',
        userInteracted: true,
        reason: 'structure',
      }),
    ).toBe(true);
    expect(
      shouldAutoFitGraph({
        previousSignature: 'a|b',
        nextSignature: 'a|b',
        userInteracted: false,
        reason: 'resize',
      }),
    ).toBe(true);
  });

  it('centers active nodes without changing current zoom level', () => {
    const viewport: GraphViewport = { x: 20, y: -10, zoom: 0.5 };
    const focused = focusViewportOnNode({ id: 'worker', position: { x: 400, y: 240 } }, viewport, {
      width: 900,
      height: 600,
    });

    expect(focused.zoom).toBe(0.5);
    expect(focused.x).toBeCloseTo(202.5);
    expect(focused.y).toBeCloseTo(156);
  });

  it('centers active nodes inside the usable canvas area when overlays consume space', () => {
    const viewport: GraphViewport = { x: 20, y: -10, zoom: 0.5 };
    const focused = focusViewportOnNode(
      { id: 'worker', position: { x: 400, y: 240 } },
      viewport,
      { width: 900, height: 600 },
      { left: 280, top: 140, right: 180, bottom: 80 },
    );

    expect(focused.zoom).toBe(0.5);
    expect(focused.x).toBeCloseTo(252.5);
    expect(focused.y).toBeCloseTo(186);
  });

  it('fits graph bounds with padding and clamped zoom', () => {
    const bounds = measuredGraphBounds([
      { id: 'a', position: { x: 120, y: 120 } },
      { id: 'b', position: { x: 520, y: 120 } },
    ]);
    const viewport = fitNativeGraphViewport(bounds, { width: 900, height: 500 });

    expect(viewport.zoom).toBeGreaterThan(0.5);
    expect(viewport.zoom).toBeLessThanOrEqual(1);
  });

  it('fits graph bounds inside the usable canvas area when overlays are present', () => {
    const bounds = measuredGraphBounds([
      { id: 'a', position: { x: 120, y: 120 } },
      { id: 'b', position: { x: 520, y: 120 } },
    ]);
    const viewport = fitNativeGraphViewport(
      bounds,
      { width: 900, height: 500 },
      { left: 280, top: 160, right: 180, bottom: 110 },
    );

    expect(viewport.zoom).toBeGreaterThan(0.3);
    expect(viewport.zoom).toBeLessThanOrEqual(1);
    expect(viewport.x).toBeGreaterThan(0);
    expect(viewport.y).toBeGreaterThan(0);
  });

  it('fits selected neighborhoods into available canvas even when it means zooming back in', () => {
    const nodes: GraphGeometryNode[] = [
      { id: 'selected', position: { x: 100, y: 80 }, width: 100, height: 80 },
      { id: 'neighbor', position: { x: 260, y: 90 }, width: 100, height: 80 },
    ];
    const viewport = fitGraphNodesViewport(nodes, { x: 0, y: 0, zoom: 0.2 }, { width: 900, height: 500 });

    expect(viewport.zoom).toBeGreaterThan(1);
  });

  it('fits selected neighborhoods relative to the usable canvas center', () => {
    const nodes: GraphGeometryNode[] = [
      { id: 'selected', position: { x: 100, y: 80 }, width: 100, height: 80 },
      { id: 'neighbor', position: { x: 260, y: 90 }, width: 100, height: 80 },
    ];
    const viewport = fitGraphNodesViewport(
      nodes,
      { x: 0, y: 0, zoom: 0.2 },
      { width: 900, height: 500 },
      { left: 260, top: 150, right: 180, bottom: 100 },
    );

    expect(viewport.x).toBeGreaterThan(200);
    expect(viewport.y).toBeGreaterThan(100);
    expect(viewport.zoom).toBeGreaterThan(0.5);
  });

  it('prefers compact fitting when a focused view shows only selected nodes', () => {
    const nodes: GraphGeometryNode[] = [
      { id: 'triage-request', position: { x: 285, y: 0 } },
      { id: 'router', position: { x: 285, y: 388 } },
      { id: 'implementer', position: { x: 570, y: 538 } },
      { id: 'reviewer', position: { x: 570, y: 388 } },
      { id: 'triage-artifact', position: { x: 570, y: 582 } },
    ];
    const bounds = measuredGraphBounds(nodes);
    const size = { width: 1280, height: 720 };
    const insets = { left: 360, top: 180, right: 430, bottom: 140 };

    const fullViewport = fitAutoGraphViewport({
      bounds,
      compact: false,
      current: { x: 0, y: 0, zoom: 0.2 },
      insets,
      nodes,
      size,
    });
    const focusedViewport = fitAutoGraphViewport({
      bounds,
      compact: true,
      current: { x: 0, y: 0, zoom: 0.2 },
      insets,
      nodes,
      size,
    });

    expect(focusedViewport.zoom).toBeGreaterThan(fullViewport.zoom);
  });

  it('projects overview metrics for the current viewport', () => {
    const overview = graphOverviewMetrics(
      { x: 0, y: 0, width: 1200, height: 600 },
      { x: 0, y: 0, zoom: 1 },
      { width: 1200, height: 600 },
      { width: 160, height: 96 },
    );

    expect(overview).toMatchObject({ width: 160, height: 80, scale: 160 / 1200 });
    expect(overview.viewport).toEqual({ x: 0, y: 0, width: 160, height: 80 });
  });

  it('finds spatial keyboard navigation neighbors by direction', () => {
    const nodes: GraphGeometryNode[] = [
      { id: 'center', position: { x: 100, y: 100 }, width: 100, height: 80 },
      { id: 'left', position: { x: -100, y: 105 }, width: 100, height: 80 },
      { id: 'right', position: { x: 330, y: 120 }, width: 100, height: 80 },
      { id: 'up', position: { x: 120, y: -140 }, width: 100, height: 80 },
      { id: 'down', position: { x: 115, y: 320 }, width: 100, height: 80 },
      { id: 'diagonal', position: { x: 250, y: 250 }, width: 100, height: 80 },
    ];

    expect(findSpatialNeighborNodeId(nodes, 'center', 'left')).toBe('left');
    expect(findSpatialNeighborNodeId(nodes, 'center', 'right')).toBe('right');
    expect(findSpatialNeighborNodeId(nodes, 'center', 'up')).toBe('up');
    expect(findSpatialNeighborNodeId(nodes, 'center', 'down')).toBe('down');
    expect(findSpatialNeighborNodeId(nodes, 'missing', 'right')).toBeUndefined();
  });
});

function labelIntersectsNode(
  edge: { labelX: number; labelY: number },
  node: GraphGeometryNode,
  width: number,
  height: number,
): boolean {
  const left = edge.labelX - width / 2;
  const right = edge.labelX + width / 2;
  const top = edge.labelY - height / 2;
  const bottom = edge.labelY + height / 2;

  return (
    right > node.position.x &&
    left < node.position.x + graphNodeWidth &&
    bottom > node.position.y &&
    top < node.position.y + graphNodeHeight
  );
}
