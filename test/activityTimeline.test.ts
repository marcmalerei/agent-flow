import { describe, expect, it } from 'vitest';
import { buildActivityTimeline, filterTimelineEvents } from '../src/activity/timeline';
import { AgentFlowActivityEvent } from '../src/activity/types';

const events: AgentFlowActivityEvent[] = [
  { id: '2', timestamp: '2026-06-15T10:00:02.000Z', sessionId: 's1', phase: 'tool', nodeId: 'router', toolName: 'read/readFile', summary: 'Read files.' },
  { id: '1', timestamp: '2026-06-15T10:00:01.000Z', sessionId: 's1', phase: 'started', nodeId: 'router', summary: 'Started router.' },
  { id: '3', timestamp: '2026-06-15T10:00:03.000Z', sessionId: 's1', phase: 'handoff', nodeId: 'router', targetNodeId: 'worker', summary: 'Hand off.' },
  { id: '4', timestamp: '2026-06-15T10:00:04.000Z', sessionId: 's2', phase: 'failed', nodeId: 'worker', summary: 'Failed.', severity: 'error' }
];

describe('activity timeline', () => {
  it('groups events chronologically by session and node', () => {
    const timeline = buildActivityTimeline(events);
    expect(timeline.sessions.map((session) => session.sessionId)).toEqual(['s1', 's2']);
    expect(timeline.sessions[0].events.map((event) => event.id)).toEqual(['1', '2', '3']);
    expect(timeline.sessions[0].nodes).toEqual([
      expect.objectContaining({ nodeId: 'router', events: [events[1], events[0], events[2]] })
    ]);
    expect(timeline.sessions[1].nodes).toEqual([
      expect.objectContaining({ nodeId: 'worker', failed: true })
    ]);
  });

  it('filters by session, node, phase, and text', () => {
    expect(filterTimelineEvents(events, { sessionId: 's1' }).map((event) => event.id)).toEqual(['2', '1', '3']);
    expect(filterTimelineEvents(events, { nodeId: 'router', phase: 'handoff' }).map((event) => event.id)).toEqual(['3']);
    expect(filterTimelineEvents(events, { query: 'read' }).map((event) => event.id)).toEqual(['2']);
  });
});
