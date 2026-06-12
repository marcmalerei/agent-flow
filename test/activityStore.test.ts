import { describe, expect, it } from 'vitest';
import { ActivityStore, resolveActivityNodeId } from '../src/activity/store';
import { AgentPipeline } from '../src/pipeline/types';

const pipeline: AgentPipeline = {
  version: 1,
  name: 'Activity',
  nodes: [
    { id: 'router', type: 'agent', label: 'Router', agentFile: '.github/agents/router.agent.md' },
    { id: 'review', type: 'prompt', label: 'Review Prompt', promptFile: '.github/prompts/review.prompt.md' }
  ],
  edges: []
};

describe('ActivityStore', () => {
  it('normalizes events, resolves node files, notifies subscribers, and prunes old entries', () => {
    const store = new ActivityStore({ maxEvents: 2, pipelineProvider: () => pipeline });
    const snapshots: number[] = [];
    store.subscribe((events) => snapshots.push(events.length));

    store.append({ sessionId: 's1', nodeFile: '.github/agents/router.agent.md', phase: 'started', summary: 'Router started' });
    store.append({ sessionId: 's1', nodeId: 'review', phase: 'tool', toolName: 'read', summary: 'Read prompt' });
    store.append({ sessionId: 's1', nodeId: 'missing', phase: 'completed', summary: 'Done' });

    const events = store.getEvents();
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(expect.objectContaining({ nodeId: 'review', phase: 'tool', toolName: 'read' }));
    expect(events[1]).toEqual(expect.objectContaining({ nodeId: 'missing', phase: 'completed', summary: 'Done' }));
    expect(snapshots).toEqual([0, 1, 2, 2]);
  });

  it('resolves node ids by id, label, and backing file', () => {
    expect(resolveActivityNodeId(pipeline, { nodeId: 'router' })).toBe('router');
    expect(resolveActivityNodeId(pipeline, { nodeId: 'Review Prompt' })).toBe('review');
    expect(resolveActivityNodeId(pipeline, { nodeFile: '.github/prompts/review.prompt.md' })).toBe('review');
    expect(resolveActivityNodeId(pipeline, { nodeId: 'unknown' })).toBe('unknown');
  });
});
