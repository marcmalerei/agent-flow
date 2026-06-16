import { describe, expect, it } from 'vitest';
import { deriveInspectorSyncStatus } from '../src/webview/inspectorStatus';
import { NodeRuntimeState } from '../src/webview/nodeRuntimeState';

const cleanRuntime: NodeRuntimeState = {
  nodeId: 'router',
  fileVersion: 1,
  status: 'clean',
  activity: 'idle',
  dirty: false
};

describe('inspector sync status', () => {
  it('shows saved state when no runtime or validation signal needs attention', () => {
    expect(deriveInspectorSyncStatus({ runtime: cleanRuntime, findingSeverities: [] })).toMatchObject({
      kind: 'saved',
      label: 'Saved'
    });
  });

  it('prioritizes validation errors over runtime activity', () => {
    expect(deriveInspectorSyncStatus({
      runtime: { ...cleanRuntime, activity: 'writing', activitySummary: 'Updated file' },
      findingSeverities: ['error']
    })).toMatchObject({
      kind: 'needs-attention',
      label: 'Needs attention'
    });
  });

  it('reports live runtime activity with the current activity summary', () => {
    expect(deriveInspectorSyncStatus({
      runtime: { ...cleanRuntime, activity: 'reading', activitySummary: 'Read artifact' },
      findingSeverities: []
    })).toMatchObject({
      kind: 'running',
      label: 'Reading',
      detail: 'Read artifact'
    });
  });

  it('marks stale local edits as sync pending', () => {
    expect(deriveInspectorSyncStatus({
      runtime: { ...cleanRuntime, dirty: true, status: 'stale' },
      findingSeverities: []
    })).toMatchObject({
      kind: 'external-change',
      label: 'Sync pending'
    });
  });
});
