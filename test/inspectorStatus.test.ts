import { describe, expect, it } from 'vitest';
import { deriveInspectorSyncStatus } from '../src/webview/inspectorStatus';
import { NodeRuntimeState } from '../src/webview/nodeRuntimeState';

const baseRuntime: NodeRuntimeState = {
  nodeId: 'agent',
  filePath: '.github/agents/agent.agent.md',
  fileVersion: 1,
  status: 'clean',
  activity: 'idle',
  dirty: false
};

describe('inspector sync status', () => {
  it('shows saved when the selected node has no runtime or validation concern', () => {
    expect(deriveInspectorSyncStatus({ runtime: baseRuntime })).toMatchObject({
      kind: 'saved',
      label: 'Saved',
      icon: 'pass'
    });
  });

  it('prioritizes validation errors over runtime activity', () => {
    expect(deriveInspectorSyncStatus({
      runtime: { ...baseRuntime, activity: 'writing', activitySummary: 'Writing artifact.' },
      findingSeverities: ['error']
    })).toMatchObject({
      kind: 'needs-attention',
      label: 'Needs attention',
      icon: 'warning'
    });
  });

  it('surfaces live node activity in the inspector header', () => {
    expect(deriveInspectorSyncStatus({
      runtime: { ...baseRuntime, activity: 'reading', activitySummary: 'Read plan artifact.' }
    })).toMatchObject({
      kind: 'running',
      label: 'Reading',
      detail: 'Read plan artifact.',
      icon: 'pulse'
    });
  });

  it('distinguishes pending external sync from saved state', () => {
    expect(deriveInspectorSyncStatus({
      runtime: { ...baseRuntime, dirty: true, status: 'stale' }
    })).toMatchObject({
      kind: 'external-change',
      label: 'Sync pending',
      icon: 'sync'
    });
  });

  it('marks warnings and risk findings as review recommended after runtime is idle', () => {
    expect(deriveInspectorSyncStatus({
      runtime: baseRuntime,
      findingSeverities: ['risk', 'warning']
    })).toMatchObject({
      kind: 'needs-attention',
      label: 'Review recommended',
      icon: 'warning'
    });
  });
});
