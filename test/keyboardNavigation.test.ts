import { describe, expect, it } from 'vitest';
import { spatialNeighborNodeId } from '../src/webview/keyboardNavigation';

const nodes = [
  { id: 'center', position: { x: 100, y: 100 }, width: 100, height: 60 },
  { id: 'left', position: { x: -80, y: 105 }, width: 100, height: 60 },
  { id: 'right', position: { x: 300, y: 110 }, width: 100, height: 60 },
  { id: 'up', position: { x: 95, y: -80 }, width: 100, height: 60 },
  { id: 'down', position: { x: 110, y: 280 }, width: 100, height: 60 },
  { id: 'far-right', position: { x: 600, y: 90 }, width: 100, height: 60 }
];

describe('keyboard graph navigation', () => {
  it('selects the nearest spatial node in the arrow direction', () => {
    expect(spatialNeighborNodeId(nodes, 'center', 'ArrowLeft')).toBe('left');
    expect(spatialNeighborNodeId(nodes, 'center', 'ArrowRight')).toBe('right');
    expect(spatialNeighborNodeId(nodes, 'center', 'ArrowUp')).toBe('up');
    expect(spatialNeighborNodeId(nodes, 'center', 'ArrowDown')).toBe('down');
  });

  it('returns undefined when there is no node in that direction', () => {
    expect(spatialNeighborNodeId(nodes, 'left', 'ArrowLeft')).toBeUndefined();
    expect(spatialNeighborNodeId(nodes, 'up', 'ArrowUp')).toBeUndefined();
  });
});
