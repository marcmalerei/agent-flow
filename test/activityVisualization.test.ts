import { describe, expect, it } from 'vitest';
import { activeEdgeIds, recentActivityEvents, summarizeNodeActivity } from '../src/webview/activity';
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

  it('expires visual activity without removing timeline history', () => {
    const events: AgentFlowActivityEvent[] = [
      { id: 'old', timestamp: '2026-06-12T09:59:30.000Z', sessionId: 's', nodeId: 'router', phase: 'started', summary: 'Old' },
      { id: 'new', timestamp: '2026-06-12T09:59:58.000Z', sessionId: 's', nodeId: 'router', phase: 'tool', summary: 'New' }
    ];

    expect(recentActivityEvents(events, Date.parse(now), 15_000).map((event) => event.id)).toEqual(['new']);
  });
});
