import { describe, expect, it } from 'vitest';
import { AgentFlowActivityEvent } from '../src/activity/types';
import { AgentPipeline } from '../src/pipeline/types';
import { deriveNodeRuntimeState, mergeNodeRuntimeState } from '../src/webview/nodeRuntimeState';

const pipeline: AgentPipeline = {
  version: 1,
  name: 'Runtime',
  nodes: [
    { id: 'router', type: 'agent', label: 'router', agentFile: '.github/agents/router.agent.md', tools: [], calls: [], outputs: ['.github/artifacts/plan.md'] },
    { id: 'plan', type: 'artifact', label: 'plan', path: '.github/artifacts/plan.md' },
    { id: 'docs', type: 'instruction', label: 'docs', instructionFile: '.github/instructions/docs.instructions.md' }
  ],
  edges: []
};

describe('node runtime state', () => {
  it('derives per-node file versions and activity from pipeline activity events', () => {
    const events: AgentFlowActivityEvent[] = [
      { id: '1', timestamp: '2026-06-15T08:00:00.000Z', sessionId: 'fs', nodeId: 'router', nodeFile: '.github/agents/router.agent.md', phase: 'file', summary: 'Updated router' },
      { id: '2', timestamp: '2026-06-15T08:00:02.000Z', sessionId: 'fs', nodeId: 'router', artifactPath: '.github/artifacts/plan.md', phase: 'artifact', summary: 'Updated artifact' },
      { id: '3', timestamp: '2026-06-15T08:00:03.000Z', sessionId: 'fs', nodeId: 'docs', nodeFile: '.github/instructions/docs.instructions.md', phase: 'failed', summary: 'Failed instruction parse', severity: 'error' }
    ];

    const runtime = deriveNodeRuntimeState(pipeline, events, Date.parse('2026-06-15T08:00:04.000Z'));

    expect(runtime.router).toMatchObject({
      nodeId: 'router',
      filePath: '.github/agents/router.agent.md',
      fileVersion: 2,
      status: 'clean',
      activity: 'writing',
      activitySummary: 'Updated artifact'
    });
    expect(runtime.docs).toMatchObject({
      nodeId: 'docs',
      filePath: '.github/instructions/docs.instructions.md',
      fileVersion: 1,
      status: 'error',
      activity: 'failed',
      activitySummary: 'Failed instruction parse'
    });
    expect(runtime.plan).toMatchObject({
      nodeId: 'plan',
      filePath: '.github/artifacts/plan.md',
      fileVersion: 0,
      status: 'clean',
      activity: 'idle'
    });
  });

  it('keeps dirty and stale node state across remote pipeline refreshes', () => {
    const current = deriveNodeRuntimeState(pipeline, [], Date.parse('2026-06-15T08:00:00.000Z'));
    const dirtyCurrent = {
      ...current,
      router: { ...current.router, dirty: true, status: 'stale' as const, fileVersion: 4 }
    };
    const incoming = deriveNodeRuntimeState(pipeline, [
      { id: '1', timestamp: '2026-06-15T08:00:05.000Z', sessionId: 'fs', nodeId: 'router', nodeFile: '.github/agents/router.agent.md', phase: 'file', summary: 'Updated router' }
    ], Date.parse('2026-06-15T08:00:06.000Z'));

    const merged = mergeNodeRuntimeState(dirtyCurrent, incoming, pipeline);

    expect(merged.router).toMatchObject({
      dirty: true,
      status: 'stale',
      fileVersion: 5,
      activity: 'writing',
      activitySummary: 'Updated router'
    });
    expect(Object.keys(merged).sort()).toEqual(['docs', 'plan', 'router']);
  });
});
