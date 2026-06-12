import { describe, expect, it } from 'vitest';
import { ActivityStore } from '../src/activity/store';
import { completeNodeActivity, reportActivity, selectActivityNode } from '../src/activity/tools';
import { AgentPipeline } from '../src/pipeline/types';

const pipeline: AgentPipeline = {
  version: 1,
  name: 'Tools',
  nodes: [
    { id: 'router', type: 'agent', label: 'Router', agentFile: '.github/agents/router.agent.md' },
    { id: 'worker', type: 'agent', label: 'Worker', agentFile: '.github/agents/worker.agent.md' }
  ],
  edges: []
};

describe('activity tool handlers', () => {
  it('selects nodes and records activity events without raw prompt content', () => {
    const store = new ActivityStore({ pipelineProvider: () => pipeline });

    const selected = selectActivityNode({ node: 'Router', sessionId: 'demo' }, { pipeline, store });
    const report = reportActivity({ sessionId: 'demo', node: 'Router', phase: 'tool', summary: 'Using read tool', toolName: 'read', prompt: 'secret prompt text' }, { pipeline, store });
    const complete = completeNodeActivity({ sessionId: 'demo', node: 'Router', failed: false, summary: 'Finished' }, { pipeline, store });

    expect(selected).toEqual({ nodeId: 'router', label: 'Router' });
    expect(report.event).toEqual(expect.objectContaining({ nodeId: 'router', phase: 'tool', summary: 'Using read tool', toolName: 'read' }));
    expect(complete.event).toEqual(expect.objectContaining({ nodeId: 'router', phase: 'completed', summary: 'Finished' }));
    expect(JSON.stringify(store.getEvents())).not.toContain('secret prompt text');
  });

  it('can mark node activity as failed', () => {
    const store = new ActivityStore({ pipelineProvider: () => pipeline });
    const result = completeNodeActivity({ sessionId: 'demo', node: '.github/agents/worker.agent.md', failed: true, summary: 'Tests failed' }, { pipeline, store });

    expect(result.event).toEqual(expect.objectContaining({ nodeId: 'worker', phase: 'failed', severity: 'error' }));
  });
});
