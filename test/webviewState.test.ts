import { describe, expect, it } from 'vitest';
import { mergeRemoteStateUpdate } from '../src/webview/stateUpdates';
import { AgentPipeline } from '../src/pipeline/types';
import { deriveNodeRuntimeState } from '../src/webview/nodeRuntimeState';

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
    const currentRuntime = deriveNodeRuntimeState(currentPipeline, []);
    const incomingRuntime = deriveNodeRuntimeState(currentPipeline, [
      { id: 'activity-1', sessionId: 's', timestamp: '2026-06-13T18:00:00.000Z', phase: 'file', nodeId: 'agent', nodeFile: '.github/agents/agent.agent.md', summary: 'Updated file' }
    ]);
    const result = mergeRemoteStateUpdate({
      currentState: {
        pipeline: currentPipeline,
        findings: [{ severity: 'warning', ruleId: 'local', message: 'Local finding' }],
        risk: { score: 1, reasons: ['local'] },
        generatedFiles: [{ path: '.github/agents/agent.agent.md', kind: 'agent' }],
        activityEvents: [],
        nodeRuntime: { agent: { ...currentRuntime.agent, dirty: true, status: 'stale' } }
      },
      currentDraft: currentPipeline,
      incomingState: {
        pipeline: incomingPipeline,
        findings: [],
        risk: { score: 0, reasons: [] },
        generatedFiles: [],
        activityEvents: [{ id: 'activity-1', sessionId: 's', timestamp: '2026-06-13T18:00:00.000Z', phase: 'file', summary: 'Updated file' }],
        nodeRuntime: incomingRuntime
      },
      dirty: true
    });

    expect(result.applyDraft).toBe(false);
    expect(result.state.pipeline).toBe(currentPipeline);
    expect(result.state.findings).toEqual([{ severity: 'warning', ruleId: 'local', message: 'Local finding' }]);
    expect(result.state.activityEvents).toHaveLength(1);
    expect(result.state.nodeRuntime?.agent).toMatchObject({ dirty: true, status: 'stale', activity: 'writing' });
  });

  it('reports a selected-node edit conflict when that node changes externally while dirty', () => {
    const incomingSelectedPipeline: AgentPipeline = {
      version: 1,
      name: 'Incoming selected',
      nodes: [{ id: 'agent', type: 'agent', label: 'externally edited', agentFile: '.github/agents/agent.agent.md', tools: [], calls: [], outputs: [] }],
      edges: []
    };
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
        pipeline: incomingSelectedPipeline,
        findings: [],
        risk: { score: 0, reasons: [] },
        generatedFiles: [],
        activityEvents: []
      },
      dirty: true,
      selectedId: 'agent'
    });

    expect(result.applyDraft).toBe(false);
    expect(result.draft).toBe(currentPipeline);
    expect(result.conflict).toEqual({
      filePath: '.github/agents/agent.agent.md',
      incomingPipeline: incomingSelectedPipeline,
      nodeId: 'agent',
      nodeLabel: 'locally edited'
    });
  });

  it('applies remote state updates when the webview draft is clean', () => {
    const nextPipeline: AgentPipeline = {
      version: 1,
      name: 'Incoming scan',
      nodes: [{ id: 'incoming', type: 'agent', label: 'incoming', tools: [], calls: [], outputs: [] }],
      edges: []
    };
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
        pipeline: nextPipeline,
        findings: [],
        risk: { score: 0, reasons: [] },
        generatedFiles: [],
        activityEvents: []
      },
      dirty: false
    });

    expect(result.applyDraft).toBe(true);
    expect(result.draft).toBe(nextPipeline);
    expect(result.state.pipeline).toBe(nextPipeline);
  });

  it('keeps the last non-empty graph when a clean webview receives a transient empty remote state', () => {
    const result = mergeRemoteStateUpdate({
      currentState: {
        pipeline: currentPipeline,
        findings: [{ severity: 'warning', ruleId: 'current', message: 'Keep current' }],
        risk: { score: 3, reasons: ['current'] },
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
      dirty: false
    });

    expect(result.applyDraft).toBe(false);
    expect(result.draft).toBe(currentPipeline);
    expect(result.state.pipeline).toBe(currentPipeline);
    expect(result.state.activityEvents).toHaveLength(1);
  });

  it('keeps the last graph when a clean webview receives a suspicious partial remote state', () => {
    const current: AgentPipeline = {
      version: 1,
      name: 'Current',
      nodes: [
        { id: 'router', type: 'agent', label: 'router', agentFile: '.github/agents/router.agent.md', tools: [], calls: [], outputs: [] },
        { id: 'worker', type: 'agent', label: 'worker', agentFile: '.github/agents/worker.agent.md', tools: [], calls: [], outputs: [] },
        { id: 'plan', type: 'artifact', label: 'plan', path: '.github/artifacts/plan.md' }
      ],
      edges: []
    };
    const partial: AgentPipeline = {
      version: 1,
      name: 'Partial',
      nodes: [{ id: 'router', type: 'agent', label: 'router', agentFile: '.github/agents/router.agent.md', tools: [], calls: [], outputs: [] }],
      edges: []
    };
    const result = mergeRemoteStateUpdate({
      currentState: {
        pipeline: current,
        findings: [{ severity: 'warning', ruleId: 'current', message: 'Keep current' }],
        risk: { score: 3, reasons: ['current'] },
        generatedFiles: [{ path: '.github/agents/router.agent.md', kind: 'agent' }],
        activityEvents: []
      },
      currentDraft: current,
      incomingState: {
        pipeline: partial,
        findings: [],
        risk: { score: 0, reasons: [] },
        generatedFiles: [],
        activityEvents: [{ id: 'activity-1', sessionId: 's', timestamp: '2026-06-13T18:00:00.000Z', phase: 'file', summary: 'Updated file' }]
      },
      dirty: false
    });

    expect(result.applyDraft).toBe(false);
    expect(result.draft).toBe(current);
    expect(result.state.pipeline).toBe(current);
    expect(result.state.activityEvents).toHaveLength(1);
  });
});
