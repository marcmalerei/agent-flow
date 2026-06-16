import type { FlowEmptyStateKind } from './emptyState';

export type GraphRecoveryStateKind = 'none' | 'loading' | 'rendering' | 'render-failed' | 'no-visible-nodes' | 'empty';

export interface GraphRecoveryStateInput {
  nodeCount: number;
  edgeCount: number;
  renderedNodeCount?: number;
  visibleNodeCount?: number;
  emptyStateKind: FlowEmptyStateKind;
  reason?: string;
  runtimeError?: string;
}

export interface GraphRecoveryState {
  kind: GraphRecoveryStateKind;
  title: string;
  detail: string;
  actionLabels: string[];
}

export function deriveGraphRecoveryState(input: GraphRecoveryStateInput): GraphRecoveryState {
  if (input.runtimeError) {
    return state('render-failed', 'Graph render needs attention', input.runtimeError, ['Retry render', 'Copy debug snapshot', 'Open diagnostics']);
  }
  if (input.nodeCount <= 0) {
    return input.emptyStateKind === 'none'
      ? state('loading', 'Loading pipeline files', 'Scanning .github customization files before drawing the graph.', ['Scan Workspace'])
      : state('empty', 'No graph nodes to render', 'Use the empty-state actions to create or scan a pipeline.', []);
  }
  if (input.renderedNodeCount === undefined) {
    return state('rendering', 'Rendering graph', `Parsed ${input.nodeCount} nodes / ${input.edgeCount} edges. Preparing the canvas.`, []);
  }
  if (input.renderedNodeCount === 0) {
    const lateCheck = /render-check-(1200|2400)/.test(input.reason ?? '');
    return lateCheck
      ? state('render-failed', 'Graph render needs attention', `Parsed ${input.nodeCount} nodes, but none reached the canvas. Keep this graph state and retry rendering.`, ['Retry render', 'Copy debug snapshot', 'Open diagnostics'])
      : state('rendering', 'Rendering graph', `Parsed ${input.nodeCount} nodes / ${input.edgeCount} edges. Waiting for DOM nodes.`, []);
  }
  if ((input.visibleNodeCount ?? 0) === 0) {
    return state('no-visible-nodes', 'Graph is rendered off screen', `Rendered ${input.renderedNodeCount} nodes, but none are visible in the current viewport.`, ['Fit graph', 'Copy debug snapshot']);
  }
  return state('none', '', '', []);
}

function state(kind: GraphRecoveryStateKind, title: string, detail: string, actionLabels: string[]): GraphRecoveryState {
  return { kind, title, detail, actionLabels };
}
