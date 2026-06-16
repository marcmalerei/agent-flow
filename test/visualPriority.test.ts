import { describe, expect, it } from 'vitest';
import { edgeVisualPriorityClass, graphVisualPriorityOrder, nodeVisualPriorityClass } from '../src/webview/visualPriority';

describe('graph visual priority rules', () => {
  it('defines an explicit collision priority order from selected content to support labels', () => {
    expect(graphVisualPriorityOrder).toEqual([
      'selected-node',
      'active-activity',
      'status-badges',
      'static-edge-label',
      'support-edge-label'
    ]);
  });

  it('classifies node surfaces by the highest-priority visible state', () => {
    expect(nodeVisualPriorityClass({ selected: true, active: true, hasStatus: true })).toBe('node-priority-selected');
    expect(nodeVisualPriorityClass({ active: true, hasStatus: true })).toBe('node-priority-activity');
    expect(nodeVisualPriorityClass({ hasStatus: true })).toBe('node-priority-status');
    expect(nodeVisualPriorityClass({ related: true })).toBe('node-priority-related');
    expect(nodeVisualPriorityClass({ muted: true })).toBe('node-priority-muted');
    expect(nodeVisualPriorityClass({})).toBe('node-priority-normal');
  });

  it('classifies edge label priority so support labels stay behind selected and active paths', () => {
    expect(edgeVisualPriorityClass({ active: true, selected: true, support: true })).toBe('edge-priority-active');
    expect(edgeVisualPriorityClass({ selected: true, support: true })).toBe('edge-priority-selected');
    expect(edgeVisualPriorityClass({ support: true })).toBe('edge-priority-support');
    expect(edgeVisualPriorityClass({})).toBe('edge-priority-static');
  });
});
