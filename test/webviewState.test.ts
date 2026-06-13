import { describe, expect, it } from 'vitest';
import { mergeRemoteStateUpdate } from '../src/webview/stateUpdates';
import { AgentPipeline } from '../src/pipeline/types';

describe('webview state updates', () => {
  const currentPipeline: AgentPipeline = {
    version: 1,
    name: 'Current draft',
    nodes: [{ id: 'agent', type: 'agent', label: 'locally edited', tools: [], calls: [], outputs: [] }],
    edges: []
  };
  const incomingPipeline: AgentPipeline = {
    version: 1,
    name: 'Incoming scan',
    nodes: [],
    edges: []
  };

  it('does not replace the local draft when a remote state update arrives during editing', () => {
    const result = mergeRemoteStateUpdate({
      currentState: {
        pipeline: currentPipeline,
        findings: [{ severity: 'warning', ruleId: 'local', message: 'Local finding' }],
        risk: { score: 1, reasons: ['local'] },
        generatedFiles: [{ path: '.github/agents/agent.agent.md', kind: 'agent' }],
        activityEvents: []
      },
      currentDraft: currentPipeline,
      incomingState: {
        pipeline: incomingPipeline,
        findings: [],
        risk: { score: 0, reasons: [] },
        generatedFiles: [],
        activityEvents: [{ id: 'activity-1', sessionId: 's', timestamp: '2026-06-13T18:00:00.000Z', phase: 'file', summary: 'Updated file' }]
      },
      dirty: true
    });

    expect(result.applyDraft).toBe(false);
    expect(result.state.pipeline).toBe(currentPipeline);
    expect(result.state.findings).toEqual([{ severity: 'warning', ruleId: 'local', message: 'Local finding' }]);
    expect(result.state.activityEvents).toHaveLength(1);
  });

  it('applies remote state updates when the webview draft is clean', () => {
    const result = mergeRemoteStateUpdate({
      currentState: {
        pipeline: currentPipeline,
        findings: [],
        risk: { score: 0, reasons: [] },
        generatedFiles: [],
        activityEvents: []
      },
      currentDraft: currentPipeline,
      incomingState: {
        pipeline: incomingPipeline,
        findings: [],
        risk: { score: 0, reasons: [] },
        generatedFiles: [],
        activityEvents: []
      },
      dirty: false
    });

    expect(result.applyDraft).toBe(true);
    expect(result.draft).toBe(incomingPipeline);
    expect(result.state.pipeline).toBe(incomingPipeline);
  });
});
