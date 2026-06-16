export const graphVisualPriorityOrder = [
  'selected-node',
  'active-activity',
  'status-badges',
  'static-edge-label',
  'support-edge-label'
] as const;

export type GraphVisualPriority = typeof graphVisualPriorityOrder[number];

export interface NodeVisualPriorityState {
  active?: boolean;
  hasStatus?: boolean;
  muted?: boolean;
  related?: boolean;
  selected?: boolean;
}

export interface EdgeVisualPriorityState {
  active?: boolean;
  selected?: boolean;
  support?: boolean;
}

export function nodeVisualPriorityClass(state: NodeVisualPriorityState): string {
  if (state.selected) return 'node-priority-selected';
  if (state.active) return 'node-priority-activity';
  if (state.hasStatus) return 'node-priority-status';
  if (state.related) return 'node-priority-related';
  if (state.muted) return 'node-priority-muted';
  return 'node-priority-normal';
}

export function edgeVisualPriorityClass(state: EdgeVisualPriorityState): string {
  if (state.active) return 'edge-priority-active';
  if (state.selected) return 'edge-priority-selected';
  if (state.support) return 'edge-priority-support';
  return 'edge-priority-static';
}
