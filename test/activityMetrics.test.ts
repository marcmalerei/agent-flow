import { describe, expect, it } from 'vitest';
import { aggregateActivityMetrics } from '../src/activity/metrics';
import { AgentPipeline } from '../src/pipeline/types';

const pipeline: AgentPipeline = {
  name: 'Metrics demo',
  version: 1,
  nodes: [
    { id: 'router', type: 'agent', label: 'router', tools: [], calls: [], inputs: [], outputs: [] },
    { id: 'writer', type: 'agent', label: 'writer', tools: [], calls: [], inputs: [], outputs: [] }
  ],
  edges: []
};

describe('activity metrics', () => {
  it('aggregates sessions, node counts, phases, file attention, and tokens', () => {
    const metrics = aggregateActivityMetrics(pipeline, [
      { id: '1', timestamp: '2026-06-15T10:00:00.000Z', sessionId: 's1', phase: 'started', nodeId: 'router', summary: 'Start.' },
      { id: '2', timestamp: '2026-06-15T10:00:01.000Z', sessionId: 's1', phase: 'tool', nodeId: 'router', toolName: 'read/readFile', nodeFile: '.github/agents/router.agent.md', summary: 'Read router.', tokenEstimate: 10, inputTokens: 8, outputTokens: 2 },
      { id: '3', timestamp: '2026-06-15T10:00:02.000Z', sessionId: 's1', phase: 'artifact', nodeId: 'writer', artifactPath: '.github/artifacts/plan.md', toolName: 'edit/editFiles', summary: 'Write plan.', tokenEstimate: 25, inputTokens: 5, outputTokens: 20 },
      { id: '4', timestamp: '2026-06-15T10:00:03.000Z', sessionId: 's2', phase: 'failed', nodeId: 'writer', summary: 'Failed.', severity: 'error' }
    ]);

    expect(metrics.summary).toMatchObject({
      sessions: 2,
      activeNodes: 2,
      completed: 0,
      failed: 1,
      fileReads: 1,
      fileWrites: 1,
      artifactsTouched: 1,
      tokenEstimate: 35,
      inputTokens: 13,
      outputTokens: 22
    });
    expect(metrics.nodes).toEqual([
      expect.objectContaining({ nodeId: 'writer', eventCount: 2, failedCount: 1, tokenEstimate: 25 }),
      expect.objectContaining({ nodeId: 'router', eventCount: 2, failedCount: 0, tokenEstimate: 10 })
    ]);
    expect(metrics.files[0]).toMatchObject({
      path: '.github/artifacts/plan.md',
      writes: 1,
      tokens: 25,
      nodeIds: ['writer']
    });
  });

  it('returns empty metrics without activity', () => {
    const metrics = aggregateActivityMetrics(pipeline, []);
    expect(metrics.summary).toMatchObject({ sessions: 0, activeNodes: 0, tokenEstimate: 0 });
    expect(metrics.nodes).toEqual([]);
    expect(metrics.files).toEqual([]);
  });
});
