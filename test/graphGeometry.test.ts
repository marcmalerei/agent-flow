import { describe, expect, it } from 'vitest';
import { edgePathBetweenNodes, fitNativeGraphViewport, focusViewportOnNode, measuredGraphBounds, normalizeGraphNodePositions, shouldAutoFitGraph, type GraphGeometryNode, type GraphViewport } from '../src/webview/graphGeometry';

const source: GraphGeometryNode = { id: 'source', position: { x: 0, y: 40 } };
const target: GraphGeometryNode = { id: 'target', position: { x: 320, y: 40 } };

describe('native graph geometry', () => {
  it('anchors horizontal edges exactly on source and target node borders', () => {
    const edge = edgePathBetweenNodes(source, target);

    expect(edge.start).toEqual({ x: 190, y: 88 });
    expect(edge.end).toEqual({ x: 320, y: 88 });
    expect(edge.path.startsWith('M 190 88 ')).toBe(true);
    expect(edge.path.endsWith(' 320 88')).toBe(true);
  });

  it('places short edge labels outside source and target node bounds', () => {
    const closeSource: GraphGeometryNode = { id: 'source', position: { x: 0, y: 40 } };
    const closeTarget: GraphGeometryNode = { id: 'target', position: { x: 210, y: 40 } };
    const edge = edgePathBetweenNodes(closeSource, closeTarget, { labelWidth: 132, labelHeight: 22 });

    expect(labelIntersectsNode(edge, closeSource, 132, 22)).toBe(false);
    expect(labelIntersectsNode(edge, closeTarget, 132, 22)).toBe(false);
    expect(edge.labelY).toBeLessThan(closeSource.position.y);
  });

  it('normalizes nodes and bounds so SVG paths and DOM nodes share the same origin', () => {
    const normalized = normalizeGraphNodePositions([
      { id: 'a', position: { x: 100, y: 50 } },
      { id: 'b', position: { x: 360, y: 200 } }
    ]);

    expect(normalized.nodes.map((node) => [node.id, node.position])).toEqual([
      ['a', { x: 120, y: 120 }],
      ['b', { x: 380, y: 270 }]
    ]);
    expect(normalized.bounds).toEqual({ x: 0, y: 0, width: 690, height: 486 });
  });

  it('keeps manual zoom stable for activity updates but auto-fits structural graph changes', () => {
    expect(shouldAutoFitGraph({ previousSignature: 'a|b', nextSignature: 'a|b', userInteracted: true, reason: 'activity' })).toBe(false);
    expect(shouldAutoFitGraph({ previousSignature: 'a|b', nextSignature: 'a|b|c', userInteracted: true, reason: 'structure' })).toBe(true);
    expect(shouldAutoFitGraph({ previousSignature: 'a|b', nextSignature: 'a|b', userInteracted: false, reason: 'resize' })).toBe(true);
  });

  it('centers active nodes without changing the current zoom level', () => {
    const viewport: GraphViewport = { x: 20, y: -10, zoom: 0.5 };
    const focused = focusViewportOnNode({ id: 'worker', position: { x: 400, y: 240 } }, viewport, { width: 900, height: 600 });

    expect(focused.zoom).toBe(0.5);
    expect(focused.x).toBeCloseTo(202.5);
    expect(focused.y).toBeCloseTo(156);
  });

  it('fits graph bounds with padding and clamped zoom', () => {
    const bounds = measuredGraphBounds([{ id: 'a', position: { x: 120, y: 120 } }, { id: 'b', position: { x: 520, y: 120 } }]);
    const viewport = fitNativeGraphViewport(bounds, { width: 900, height: 500 });

    expect(viewport.zoom).toBeGreaterThan(0.5);
    expect(viewport.zoom).toBeLessThanOrEqual(1);
  });
});

function labelIntersectsNode(edge: { labelX: number; labelY: number }, node: GraphGeometryNode, width: number, height: number): boolean {
  const left = edge.labelX - width / 2;
  const right = edge.labelX + width / 2;
  const top = edge.labelY - height / 2;
  const bottom = edge.labelY + height / 2;
  return right > node.position.x
    && left < node.position.x + 190
    && bottom > node.position.y
    && top < node.position.y + 96;
}
