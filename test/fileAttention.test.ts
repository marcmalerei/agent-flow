import { describe, expect, it } from 'vitest';
import { aggregateFileAttention, fileAttentionDecoration } from '../src/activity/fileAttention';
import { AgentFlowActivityEvent } from '../src/activity/types';

const events: AgentFlowActivityEvent[] = [
  { id: '1', timestamp: '2026-06-15T10:00:00.000Z', sessionId: 's1', phase: 'tool', nodeId: 'router', nodeFile: '.github/agents/router.agent.md', toolName: 'read/readFile', summary: 'Read router.', tokenEstimate: 10 },
  { id: '2', timestamp: '2026-06-15T10:00:01.000Z', sessionId: 's1', phase: 'artifact', nodeId: 'writer', artifactPath: '.github/artifacts/plan.md', toolName: 'edit/editFiles', summary: 'Wrote plan.', tokenEstimate: 25 },
  { id: '3', timestamp: '2026-06-15T10:00:02.000Z', sessionId: 's1', phase: 'artifact', nodeId: 'reviewer', artifactPath: '.github/artifacts/plan.md', toolName: 'read/readFile', summary: 'Read plan.', tokenEstimate: 5 }
];

describe('file attention', () => {
  it('aggregates reads, writes, latest timestamp, node ids, and heat', () => {
    const attention = aggregateFileAttention(events);
    expect(attention).toEqual([
      expect.objectContaining({
        path: '.github/artifacts/plan.md',
        reads: 1,
        writes: 1,
        events: 2,
        tokens: 30,
        heat: 1,
        nodeIds: ['reviewer', 'writer']
      }),
      expect.objectContaining({
        path: '.github/agents/router.agent.md',
        reads: 1,
        writes: 0,
        heat: 0.5,
        nodeIds: ['router']
      })
    ]);
  });

  it('derives subtle Explorer decorations for touched files', () => {
    const attention = aggregateFileAttention(events);
    expect(fileAttentionDecoration(attention, '.github/artifacts/plan.md')).toEqual({
      badge: 'AI',
      tooltip: 'Agent Flow: 1 read, 1 write, 2 events, 30 estimated tokens'
    });
    expect(fileAttentionDecoration(attention, 'README.md')).toBeUndefined();
  });
});
