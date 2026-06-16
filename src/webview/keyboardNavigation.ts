import { findSpatialNeighborNodeId, type GraphGeometryNode } from './graphGeometry';

export type SpatialArrowKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

export function spatialNeighborNodeId(nodes: readonly GraphGeometryNode[], selectedId: string, key: SpatialArrowKey): string | undefined {
  const direction = key === 'ArrowLeft' ? 'left' : key === 'ArrowRight' ? 'right' : key === 'ArrowUp' ? 'up' : 'down';
  return findSpatialNeighborNodeId(nodes, selectedId, direction);
}
