import { ActivityPhase, AgentFlowActivityEvent } from './types';

export interface ActivityTimelineFilter {
  sessionId?: string;
  nodeId?: string;
  phase?: ActivityPhase | string;
  query?: string;
}

export interface ActivityTimelineNodeGroup {
  nodeId: string;
  events: AgentFlowActivityEvent[];
  startedAt: string;
  updatedAt: string;
  failed: boolean;
}

export interface ActivityTimelineSession {
  sessionId: string;
  events: AgentFlowActivityEvent[];
  nodes: ActivityTimelineNodeGroup[];
  startedAt: string;
  updatedAt: string;
  failed: boolean;
}

export interface ActivityTimeline {
  sessions: ActivityTimelineSession[];
}

export function buildActivityTimeline(events: readonly AgentFlowActivityEvent[]): ActivityTimeline {
  const sorted = sortEvents(events);
  const sessions = new Map<string, AgentFlowActivityEvent[]>();
  for (const event of sorted) {
    const group = sessions.get(event.sessionId) ?? [];
    group.push(event);
    sessions.set(event.sessionId, group);
  }
  return {
    sessions: [...sessions.entries()].map(([sessionId, sessionEvents]) => ({
      sessionId,
      events: sessionEvents,
      nodes: nodeGroups(sessionEvents),
      startedAt: sessionEvents[0]?.timestamp ?? '',
      updatedAt: sessionEvents.at(-1)?.timestamp ?? '',
      failed: sessionEvents.some((event) => event.phase === 'failed' || event.severity === 'error')
    }))
  };
}

export function filterTimelineEvents(events: readonly AgentFlowActivityEvent[], filter: ActivityTimelineFilter): AgentFlowActivityEvent[] {
  const query = filter.query?.trim().toLowerCase();
  return events.filter((event) => {
    if (filter.sessionId && event.sessionId !== filter.sessionId) return false;
    if (filter.nodeId && event.nodeId !== filter.nodeId && event.targetNodeId !== filter.nodeId) return false;
    if (filter.phase && event.phase !== filter.phase) return false;
    if (query && !timelineSearchText(event).includes(query)) return false;
    return true;
  });
}

function nodeGroups(events: readonly AgentFlowActivityEvent[]): ActivityTimelineNodeGroup[] {
  const groups = new Map<string, AgentFlowActivityEvent[]>();
  for (const event of events) {
    const nodeId = event.nodeId ?? event.targetNodeId;
    if (!nodeId) continue;
    const group = groups.get(nodeId) ?? [];
    group.push(event);
    groups.set(nodeId, group);
  }
  return [...groups.entries()].map(([nodeId, nodeEvents]) => ({
    nodeId,
    events: nodeEvents,
    startedAt: nodeEvents[0]?.timestamp ?? '',
    updatedAt: nodeEvents.at(-1)?.timestamp ?? '',
    failed: nodeEvents.some((event) => event.phase === 'failed' || event.severity === 'error')
  }));
}

function sortEvents(events: readonly AgentFlowActivityEvent[]): AgentFlowActivityEvent[] {
  return [...events].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp) || left.id.localeCompare(right.id));
}

function timelineSearchText(event: AgentFlowActivityEvent): string {
  return [event.summary, event.nodeId, event.targetNodeId, event.phase, event.toolName, event.artifactPath, event.nodeFile].filter(Boolean).join(' ').toLowerCase();
}
