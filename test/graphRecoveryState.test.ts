import { describe, expect, it } from 'vitest';
import { deriveGraphRecoveryState } from '../src/webview/graphRecoveryState';

describe('graph recovery state', () => {
  it('shows rendering progress when parsed nodes exist before DOM nodes are reported', () => {
    expect(deriveGraphRecoveryState({
      nodeCount: 12,
      edgeCount: 18,
      renderedNodeCount: undefined,
      visibleNodeCount: undefined,
      emptyStateKind: 'none'
    })).toMatchObject({
      kind: 'rendering',
      title: 'Rendering graph',
      detail: 'Parsed 12 nodes / 18 edges. Preparing the canvas.'
    });
  });

  it('shows a recoverable render failure when parsed nodes never reach the DOM', () => {
    expect(deriveGraphRecoveryState({
      nodeCount: 12,
      edgeCount: 18,
      renderedNodeCount: 0,
      visibleNodeCount: 0,
      emptyStateKind: 'none',
      reason: 'render-check-2400'
    })).toMatchObject({
      kind: 'render-failed',
      title: 'Graph render needs attention',
      actionLabels: ['Retry render', 'Copy debug snapshot', 'Open diagnostics']
    });
  });

  it('stays quiet when all parsed nodes are rendered and some are visible', () => {
    expect(deriveGraphRecoveryState({
      nodeCount: 12,
      edgeCount: 18,
      renderedNodeCount: 12,
      visibleNodeCount: 8,
      emptyStateKind: 'none',
      reason: 'render-check-500'
    }).kind).toBe('none');
  });

  it('explains filtered or offscreen states when rendered nodes exist but none are visible', () => {
    expect(deriveGraphRecoveryState({
      nodeCount: 12,
      edgeCount: 18,
      renderedNodeCount: 12,
      visibleNodeCount: 0,
      emptyStateKind: 'none',
      reason: 'render-check-1200'
    })).toMatchObject({
      kind: 'no-visible-nodes',
      title: 'Graph is rendered off screen',
      actionLabels: ['Fit graph', 'Copy debug snapshot']
    });
  });
});
