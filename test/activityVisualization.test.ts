import { describe, expect, it } from 'vitest';
import { activeEdgeIds, deriveActivityHudState, deriveActivityPlaybackState, freshActivityEvents, recentActivityEvents, recentActivityTrail, recentNodeActivitySummaries, resolveActivityEventsForPipeline, summarizeNodeActivity } from '../src/webview/activity';
import { AgentFlowActivityEvent } from '../src/activity/types';
import { AgentPipeline } from '../src/pipeline/types';

const pipeline: AgentPipeline = {
  version: 1,
  name: 'Activity visual',
  nodes: [
    { id: 'router', type: 'agent', label: 'Router', outputs: ['.github/artifacts/plan.md'] },
    { id: 'worker', type: 'agent', label: 'Worker', inputs: ['.github/artifacts/plan.md'] },
    { id: 'start', type: 'prompt', label: 'Start', promptFile: '.github/prompts/start.prompt.md', startAgent: 'router' },
    { id: 'docs', type: 'instruction', label: 'Docs', instructionFile: '.github/instructions/docs.instructions.md' },
    { id: 'reviewer', type: 'role', label: 'Reviewer', roleFile: '.github/roles/reviewer.md' },
    { id: 'plan', type: 'artifact', label: 'Plan', path: '.github/artifacts/plan.md' }
  ],
  edges: [{ id: 'handoff-router-worker', from: 'router', to: 'worker', kind: 'handoff', label: 'Implement' }]
};

const now = '2026-06-12T10:00:00.000Z';

describe('activity visualization helpers', () => {
  it('collapses multiple node events into stable node summaries', () => {
    const events: AgentFlowActivityEvent[] = [
      { id: '1', timestamp: now, sessionId: 's', nodeId: 'router', phase: 'started', summary: 'Started' },
      { id: '2', timestamp: now, sessionId: 's', nodeId: 'router', phase: 'tool', summary: 'Reading files', toolName: 'read' },
      { id: '3', timestamp: now, sessionId: 's', nodeId: 'worker', phase: 'failed', summary: 'Failed', severity: 'error' }
    ];

    const summaries = summarizeNodeActivity(events);

    expect(summaries.get('router')).toEqual(expect.objectContaining({ phase: 'tool', summary: 'Reading files', count: 2, toolName: 'read' }));
    expect(summaries.get('worker')).toEqual(expect.objectContaining({ phase: 'failed', severity: 'error' }));
  });

  it('maps handoff, artifact, and instruction events to visible edge ids', () => {
    const events: AgentFlowActivityEvent[] = [
      { id: '1', timestamp: now, sessionId: 's', nodeId: 'router', targetNodeId: 'worker', phase: 'handoff', summary: 'Hand off' },
      { id: '2', timestamp: now, sessionId: 's', nodeId: 'router', artifactPath: '.github/artifacts/plan.md', phase: 'artifact', summary: 'Write plan' },
      { id: '3', timestamp: now, sessionId: 's', nodeId: 'worker', artifactPath: '.github/artifacts/plan.md', phase: 'artifact', summary: 'Read plan' },
      { id: '4', timestamp: now, sessionId: 's', nodeId: 'worker', nodeFile: '.github/instructions/docs.instructions.md', phase: 'file', summary: 'Load instruction' },
      { id: '5', timestamp: now, sessionId: 's', nodeId: 'router', nodeFile: '.github/prompts/start.prompt.md', phase: 'file', summary: 'Read start prompt' }
    ];

    expect(activeEdgeIds(pipeline, events)).toEqual(expect.arrayContaining([
      'handoff-router-worker',
      'ref:artifact-output:router:plan',
      'ref:artifact-input:plan:worker',
      'ref:agent.instructionRefs:docs:worker',
      'ref:prompt:start:startAgent:router'
    ]));
  });

  it('resolves file-only activity events to pipeline nodes for visual updates', () => {
    const events: AgentFlowActivityEvent[] = [
      { id: '1', timestamp: now, sessionId: 's', nodeFile: '.github/prompts/start.prompt.md', phase: 'file', summary: 'Read prompt file' },
      { id: '2', timestamp: now, sessionId: 's', artifactPath: '.github/artifacts/plan.md', phase: 'artifact', summary: 'Read artifact file' }
    ];

    const resolved = resolveActivityEventsForPipeline(pipeline, events);

    expect(resolved).toEqual([
      expect.objectContaining({ id: '1', nodeId: 'start', nodeFile: '.github/prompts/start.prompt.md' }),
      expect.objectContaining({ id: '2', nodeId: 'plan', artifactPath: '.github/artifacts/plan.md' })
    ]);
    expect(summarizeNodeActivity(resolved).get('start')).toMatchObject({ summary: 'Read prompt file' });
    expect(summarizeNodeActivity(resolved).get('plan')).toMatchObject({ summary: 'Read artifact file' });
  });

  it('keeps recent visual activity long enough to survive webview refits', () => {
    const events: AgentFlowActivityEvent[] = [
      { id: 'old', timestamp: '2026-06-12T09:57:30.000Z', sessionId: 's', nodeId: 'router', phase: 'started', summary: 'Old' },
      { id: 'refit', timestamp: '2026-06-12T09:59:50.000Z', sessionId: 's', nodeId: 'router', phase: 'started', summary: 'Refit window' },
      { id: 'new', timestamp: '2026-06-12T09:59:58.000Z', sessionId: 's', nodeId: 'router', phase: 'tool', summary: 'New' }
    ];

    expect(recentActivityEvents(events, Date.parse(now)).map((event) => event.id)).toEqual(['refit', 'new']);
  });

  it('expires node activity summaries after the visual activity window', () => {
    const events: AgentFlowActivityEvent[] = [
      { id: 'stale', timestamp: '2026-06-12T09:57:30.000Z', sessionId: 's', nodeId: 'router', phase: 'tool', summary: 'Read stale file', toolName: 'read_file' },
      { id: 'fresh', timestamp: '2026-06-12T09:59:58.000Z', sessionId: 's', nodeId: 'worker', phase: 'tool', summary: 'Run fresh file', toolName: 'run_file' }
    ];

    const summaries = recentNodeActivitySummaries(events, Date.parse(now));

    expect(summaries.has('router')).toBe(false);
    expect(summaries.get('worker')).toMatchObject({ summary: 'Run fresh file', toolName: 'run_file' });
  });

  it('separates fresh animation events from soft recent activity', () => {
    const events: AgentFlowActivityEvent[] = [
      { id: 'recent', timestamp: '2026-06-12T09:59:30.000Z', sessionId: 's', nodeId: 'router', targetNodeId: 'worker', phase: 'handoff', summary: 'Recent handoff' },
      { id: 'fresh', timestamp: '2026-06-12T09:59:58.000Z', sessionId: 's', nodeId: 'router', phase: 'artifact', summary: 'Fresh write', artifactPath: '.github/artifacts/plan.md' }
    ];

    expect(recentActivityEvents(events, Date.parse(now)).map((event) => event.id)).toEqual(['recent', 'fresh']);
    expect(freshActivityEvents(events, Date.parse(now)).map((event) => event.id)).toEqual(['fresh']);

    const summaries = recentNodeActivitySummaries(events, Date.parse(now));
    expect(summaries.get('router')).toMatchObject({ summary: 'Fresh write', freshness: 'fresh' });
    expect(activeEdgeIds(pipeline, freshActivityEvents(events, Date.parse(now)))).toEqual(['ref:artifact-output:router:plan']);
  });

  it('uses short active pulses and subdued recent playback windows', () => {
    const events: AgentFlowActivityEvent[] = [
      { id: 'recent', timestamp: '2026-06-12T09:59:35.000Z', sessionId: 's', nodeId: 'router', phase: 'tool', summary: 'Recent' },
      { id: 'active', timestamp: '2026-06-12T09:59:59.000Z', sessionId: 's', nodeId: 'worker', phase: 'artifact', summary: 'Active write', artifactPath: '.github/artifacts/plan.md' }
    ];

    expect(freshActivityEvents(events, Date.parse(now)).map((event) => event.id)).toEqual(['active']);
    expect(recentActivityEvents(events, Date.parse(now)).map((event) => event.id)).toEqual(['recent', 'active']);
  });

  it('derives replay playback state without making stale events permanently live', () => {
    const events: AgentFlowActivityEvent[] = [
      { id: 'stale', timestamp: '2026-06-12T09:59:20.000Z', sessionId: 's', nodeId: 'router', targetNodeId: 'worker', phase: 'handoff', summary: 'Stale handoff' },
      { id: 'recent', timestamp: '2026-06-12T09:59:45.000Z', sessionId: 's', nodeId: 'worker', phase: 'tool', summary: 'Recent tool', toolName: 'read_file' }
    ];

    expect(deriveActivityPlaybackState(events, { now: Date.parse(now) })).toMatchObject({
      mode: 'recent',
      activeEvents: [],
      replayEventId: undefined
    });
    expect(deriveActivityPlaybackState(events, { now: Date.parse(now), replayEventId: 'stale' })).toMatchObject({
      mode: 'replay',
      activeEvents: [expect.objectContaining({ id: 'stale' })],
      replayEventId: 'stale'
    });
    expect(deriveActivityPlaybackState(events, { now: Date.parse(now), paused: true })).toMatchObject({
      mode: 'paused',
      activeEvents: [],
      recentEvents: [expect.objectContaining({ id: 'recent' })]
    });
  });

  it('derives a compact live HUD state and recent traceable activity trail', () => {
    const events: AgentFlowActivityEvent[] = [
      { id: 'stale', timestamp: '2026-06-12T09:57:30.000Z', sessionId: 'older', nodeId: 'router', phase: 'tool', summary: 'Stale read', toolName: 'read_file' },
      { id: 'write', timestamp: '2026-06-12T09:59:57.000Z', sessionId: 'run-1', nodeId: 'router', phase: 'artifact', summary: 'Wrote plan', artifactPath: '.github/artifacts/plan.md' },
      { id: 'handoff', timestamp: '2026-06-12T09:59:59.000Z', sessionId: 'run-1', nodeId: 'router', targetNodeId: 'worker', phase: 'handoff', summary: 'Hand off to worker' }
    ];

    expect(deriveActivityHudState(events, [], Date.parse(now))).toEqual(expect.objectContaining({
      mode: 'live',
      eventCount: 3,
      recentCount: 2,
      activeSessionId: 'run-1',
      lastSummary: 'Hand off to worker',
      sourceSummary: 'No active sources'
    }));
    expect(recentActivityTrail(events, Date.parse(now), 2)).toEqual([
      expect.objectContaining({ id: 'handoff', label: 'handoff', nodeId: 'router', targetNodeId: 'worker' }),
      expect.objectContaining({ id: 'write', label: 'artifact', nodeId: 'router', artifactPath: '.github/artifacts/plan.md' })
    ]);
  });

  it('shows a now card for the newest fresh activity only', () => {
    const events: AgentFlowActivityEvent[] = [
      { id: 'read', timestamp: '2026-06-12T09:59:50.000Z', sessionId: 'run-1', nodeId: 'worker', phase: 'tool', summary: 'Read context', toolName: 'read_file' },
      { id: 'write', timestamp: '2026-06-12T09:59:58.000Z', sessionId: 'run-1', nodeId: 'router', phase: 'artifact', summary: 'Wrote plan', artifactPath: '.github/artifacts/plan.md' }
    ];

    expect(deriveActivityHudState(events, [], Date.parse(now)).now).toEqual({
      eventId: 'write',
      nodeId: 'router',
      title: 'Now: router',
      action: 'artifact',
      detail: '.github/artifacts/plan.md',
      timestamp: '2026-06-12T09:59:58.000Z'
    });

    expect(deriveActivityHudState([
      { id: 'stale', timestamp: '2026-06-12T09:59:30.000Z', sessionId: 'run-1', nodeId: 'router', phase: 'tool', summary: 'Stale read', toolName: 'read_file' }
    ], [], Date.parse(now)).now).toBeUndefined();
  });
});
