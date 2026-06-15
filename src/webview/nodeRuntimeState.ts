import { AgentFlowActivityEvent, ActivityPhase, NodeActivitySummary } from '../activity/types';
import { nodeBackingFile } from '../activity/store';
import { AgentPipeline, PipelineNode } from '../pipeline/types';
import { summarizeNodeActivity } from './activity';

export type NodeRuntimeStatus = 'clean' | 'loading' | 'stale' | 'error';
export type NodeRuntimeActivity = 'idle' | 'reading' | 'writing' | 'running' | 'failed';

export interface NodeRuntimeState {
  nodeId: string;
  filePath?: string;
  fileVersion: number;
  status: NodeRuntimeStatus;
  activity: NodeRuntimeActivity;
  dirty: boolean;
  lastChangedAt?: number;
  activitySummary?: string;
  activityPhase?: ActivityPhase;
  activityCount?: number;
  toolName?: string;
  artifactPath?: string;
  severity?: 'info' | 'warning' | 'error';
}

export type NodeRuntimeStateMap = Record<string, NodeRuntimeState>;

export function deriveNodeRuntimeState(pipeline: AgentPipeline, events: readonly AgentFlowActivityEvent[], now = Date.now()): NodeRuntimeStateMap {
  const activityByNode = summarizeNodeActivity(events as AgentFlowActivityEvent[]);
  const eventsByNode = groupEventsByNode(events);
  const runtime: NodeRuntimeStateMap = {};

  for (const node of pipeline.nodes) {
    const activity = activityByNode.get(node.id);
    const nodeEvents = eventsByNode.get(node.id) ?? [];
    runtime[node.id] = {
      nodeId: node.id,
      filePath: nodeBackingFile(node),
      fileVersion: nodeEvents.filter(isFileVersionEvent).length,
      status: statusForActivity(activity),
      activity: activityForSummary(activity),
      dirty: false,
      lastChangedAt: lastChangedAt(nodeEvents, now),
      activitySummary: activity?.summary,
      activityPhase: activity?.phase,
      activityCount: activity?.count,
      toolName: activity?.toolName,
      artifactPath: activity?.artifactPath,
      severity: activity?.severity
    };
  }

  return runtime;
}

export function mergeNodeRuntimeState(current: NodeRuntimeStateMap | undefined, incoming: NodeRuntimeStateMap | undefined, pipeline: AgentPipeline): NodeRuntimeStateMap {
  const merged: NodeRuntimeStateMap = {};
  for (const node of pipeline.nodes) {
    const previous = current?.[node.id];
    const next = incoming?.[node.id] ?? baseRuntimeState(node);
    merged[node.id] = {
      ...next,
      fileVersion: (previous?.fileVersion ?? 0) + (next.fileVersion ?? 0),
      dirty: previous?.dirty ?? next.dirty,
      status: previous?.dirty || previous?.status === 'stale' ? previous.status : next.status,
      lastChangedAt: Math.max(previous?.lastChangedAt ?? 0, next.lastChangedAt ?? 0) || undefined
    };
  }
  return merged;
}

export function markNodeRuntimeDirty(runtime: NodeRuntimeStateMap | undefined, nodeIds: readonly string[], dirty = true): NodeRuntimeStateMap {
  if (!runtime || nodeIds.length === 0) return runtime ?? {};
  const next = { ...runtime };
  for (const nodeId of nodeIds) {
    const current = next[nodeId];
    if (!current) continue;
    next[nodeId] = { ...current, dirty, status: dirty ? 'stale' : current.status };
  }
  return next;
}

export function activitySummaryFromRuntime(runtime?: NodeRuntimeState): NodeActivitySummary | undefined {
  if (!runtime || runtime.activity === 'idle' || !runtime.activitySummary || !runtime.activityPhase) return undefined;
  return {
    nodeId: runtime.nodeId,
    phase: runtime.activityPhase,
    summary: runtime.activitySummary,
    count: runtime.activityCount ?? 1,
    updatedAt: runtime.lastChangedAt ? new Date(runtime.lastChangedAt).toISOString() : new Date(0).toISOString(),
    toolName: runtime.toolName,
    artifactPath: runtime.artifactPath,
    severity: runtime.severity
  };
}

function baseRuntimeState(node: PipelineNode): NodeRuntimeState {
  return {
    nodeId: node.id,
    filePath: nodeBackingFile(node),
    fileVersion: 0,
    status: 'clean',
    activity: 'idle',
    dirty: false
  };
}

function groupEventsByNode(events: readonly AgentFlowActivityEvent[]): Map<string, AgentFlowActivityEvent[]> {
  const grouped = new Map<string, AgentFlowActivityEvent[]>();
  for (const event of events) {
    if (!event.nodeId) continue;
    grouped.set(event.nodeId, [...(grouped.get(event.nodeId) ?? []), event]);
  }
  return grouped;
}

function isFileVersionEvent(event: AgentFlowActivityEvent): boolean {
  return event.phase === 'file' || event.phase === 'artifact' || Boolean(event.nodeFile || event.artifactPath);
}

function statusForActivity(activity?: NodeActivitySummary): NodeRuntimeStatus {
  if (!activity) return 'clean';
  if (activity.phase === 'failed' || activity.severity === 'error') return 'error';
  if (activity.phase === 'queued' || activity.phase === 'started' || activity.phase === 'thinking') return 'loading';
  return 'clean';
}

function activityForSummary(activity?: NodeActivitySummary): NodeRuntimeActivity {
  if (!activity) return 'idle';
  if (activity.phase === 'failed' || activity.severity === 'error') return 'failed';
  if (activity.phase === 'file' || activity.phase === 'artifact') return activity.summary.toLowerCase().startsWith('read') ? 'reading' : 'writing';
  if (activity.phase === 'tool') return activity.toolName?.toLowerCase().includes('read') ? 'reading' : 'running';
  if (activity.phase === 'queued' || activity.phase === 'started' || activity.phase === 'thinking' || activity.phase === 'handoff') return 'running';
  return 'idle';
}

function lastChangedAt(events: readonly AgentFlowActivityEvent[], now: number): number | undefined {
  const timestamps = events.map((event) => Date.parse(event.timestamp)).filter((timestamp) => !Number.isNaN(timestamp));
  return timestamps.length ? Math.max(...timestamps) : now || undefined;
}
