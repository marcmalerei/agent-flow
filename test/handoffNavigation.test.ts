import { describe, expect, it } from 'vitest';
import type { AgentPipeline } from '../src/pipeline/types';
import { graphNodeIdForSelection } from '../src/webview/handoffNavigation';

describe('handoff graph navigation', () => {
  const pipeline: AgentPipeline = {
    version: 1,
    name: 'handoff navigation',
    nodes: [
      { id: 'router', type: 'agent', label: 'router', agentFile: '.github/agents/router.agent.md' },
      { id: 'worker', type: 'agent', label: 'worker', agentFile: '.github/agents/worker.agent.md' },
      { id: 'router-handoff-worker', type: 'handoff', label: 'handoff to worker', sourceAgent: 'router', targetAgent: 'worker' }
    ],
    edges: []
  };

  it('selects the source agent when a materialized handoff node is clicked', () => {
    expect(graphNodeIdForSelection(pipeline, 'router-handoff-worker')).toBe('router');
  });

  it('keeps normal node selection unchanged', () => {
    expect(graphNodeIdForSelection(pipeline, 'worker')).toBe('worker');
    expect(graphNodeIdForSelection(pipeline, 'missing')).toBe('missing');
  });
});
