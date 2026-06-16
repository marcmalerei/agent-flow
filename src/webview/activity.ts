import { AgentFlowActivityEvent, NodeActivitySummary } from '../activity/types';
import type { ActivitySourceRuntimeState } from '../activity/sources';
import { AgentPipeline, PipelineNode } from '../pipeline/types';
import { nodeBackingFile } from '../activity/store';
import { deriveVisibleFlowEdges } from './graph';

export interface ActivityHudState {
  mode: 'idle' | 'live' | 'recent' | 'degraded';
  eventCount: number;
  recentCount: number;
  activeSessionId?: string;
  lastSummary?: string;
  lastTimestamp?: string;
  sourceSummary: string;
  canReportReads: boolean;
  canReportWrites: boolean;
}

export interface ActivityTrailItem {
  id: string;
  label: string;
  summary: string;
  timestamp: string;
  nodeId?: string;
  targetNodeId?: string;
  artifactPath?: string;
}

export function summarizeNodeActivity(events: AgentFlowActivityEvent[]): Map<string, NodeActivitySummary> {
  const summaries = new Map<string, NodeActivitySummary>();
  for (const event of events) {
    if (!event.nodeId) continue;
    const current = summaries.get(event.nodeId);
    summaries.set(event.nodeId, {
      nodeId: event.nodeId,
      phase: event.phase,
      summary: event.summary,
      count: (current?.count ?? 0) + 1,
      updatedAt: event.timestamp,
      toolName: event.toolName,
      artifactPath: event.artifactPath,
      severity: event.severity
    });
  }
  return summaries;
}

export function recentActivityEvents(events: AgentFlowActivityEvent[], now = Date.now(), ttlMs = 120_000): AgentFlowActivityEvent[] {
  return events.filter((event) => {
    const timestamp = Date.parse(event.timestamp);
    return !Number.isNaN(timestamp) && now - timestamp <= ttlMs;
  });
}

export function recentNodeActivitySummaries(events: AgentFlowActivityEvent[], now = Date.now(), ttlMs = 120_000): Map<string, NodeActivitySummary> {
  return summarizeNodeActivity(recentActivityEvents(events, now, ttlMs));
}

export function deriveActivityHudState(events: AgentFlowActivityEvent[], sources: ActivitySourceRuntimeState[] = [], now = Date.now()): ActivityHudState {
  const sorted = [...events].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const last = sorted.at(-1);
  const fresh = recentActivityEvents(events, now, 15_000);
  const recent = recentActivityEvents(events, now, 120_000);
  const watchingSources = sources.filter((source) => source.state === 'watching');
  const degradedSources = sources.filter((source) => source.state === 'degraded' || source.state === 'error');
  const canReportReads = watchingSources.some((source) => source.canReportReads);
  const canReportWrites = watchingSources.some((source) => source.canReportWrites);
  const mode: ActivityHudState['mode'] = fresh.length ? 'live' : recent.length ? 'recent' : degradedSources.length && events.length === 0 ? 'degraded' : 'idle';
  return {
    mode,
    eventCount: events.length,
    recentCount: recent.length,
    activeSessionId: last?.sessionId,
    lastSummary: last?.summary,
    lastTimestamp: last?.timestamp,
    sourceSummary: sourceSummary(watchingSources, degradedSources),
    canReportReads,
    canReportWrites
  };
}

export function recentActivityTrail(events: AgentFlowActivityEvent[], now = Date.now(), limit = 6): ActivityTrailItem[] {
  return recentActivityEvents(events, now, 120_000)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, limit)
    .map((event) => ({
      id: event.id,
      label: event.toolName ? compactToolName(event.toolName) : event.phase,
      summary: event.summary,
      timestamp: event.timestamp,
      nodeId: event.nodeId,
      targetNodeId: event.targetNodeId,
      artifactPath: event.artifactPath
    }));
}

export function resolveActivityEventsForPipeline(pipeline: AgentPipeline, events: AgentFlowActivityEvent[]): AgentFlowActivityEvent[] {
  const nodeIdByFile = nodeIdsByBackingFile(pipeline);
  const artifactByPath = artifactNodeIdsByPath(pipeline);
  return events.map((event) => {
    if (event.nodeId) return event;
    const nodeId = event.nodeFile ? nodeIdByFile.get(normalizePath(event.nodeFile)) : event.artifactPath ? artifactByPath.get(normalizePath(event.artifactPath)) : undefined;
    return nodeId ? { ...event, nodeId } : event;
  });
}

export function activeEdgeIds(pipeline: AgentPipeline, events: AgentFlowActivityEvent[]): string[] {
  const ids = new Set<string>();
  const nodesById = new Map(pipeline.nodes.map((node) => [node.id, node]));
  const artifactByPath = artifactNodeIdsByPath(pipeline);
  const instructionByFile = new Map(pipeline.nodes.filter((node) => node.type === 'instruction').map((node) => [normalizePath(node.instructionFile ?? `.github/instructions/${node.id}.instructions.md`), node.id]));
  const nodeIdByFile = nodeIdsByBackingFile(pipeline);
  const visibleEdges = deriveVisibleFlowEdges(pipeline);

  for (const event of events) {
    if (event.nodeId && event.targetNodeId) {
      for (const edge of pipeline.edges) {
        if (edge.from === event.nodeId && edge.to === event.targetNodeId) ids.add(edge.id);
      }
      for (const edge of visibleEdges) {
        if (edge.source === event.nodeId && edge.target === event.targetNodeId) ids.add(edge.id);
      }
    }
    if (event.nodeId && event.artifactPath) {
      const artifactPath = normalizePath(event.artifactPath);
      const artifactNodeId = artifactByPath.get(artifactPath);
      const node = nodesById.get(event.nodeId);
      if (artifactNodeId && node) {
        if (writesArtifact(node, artifactPath)) ids.add(`ref:artifact-output:${event.nodeId}:${artifactNodeId}`);
        else ids.add(`ref:artifact-input:${artifactNodeId}:${event.nodeId}`);
      }
    }
    if (event.nodeId && event.nodeFile) {
      const nodeFile = normalizePath(event.nodeFile);
      const artifactNodeId = artifactByPath.get(nodeFile);
      const eventNode = nodesById.get(event.nodeId);
      if (artifactNodeId && eventNode) {
        if (writesArtifact(eventNode, nodeFile)) ids.add(`ref:artifact-output:${event.nodeId}:${artifactNodeId}`);
        else ids.add(`ref:artifact-input:${artifactNodeId}:${event.nodeId}`);
      }
      const instructionNodeId = instructionByFile.get(nodeFile);
      if (instructionNodeId && instructionNodeId !== event.nodeId) ids.add(`ref:agent.instructionRefs:${instructionNodeId}:${event.nodeId}`);
      const fileNodeId = nodeIdByFile.get(nodeFile);
      if (fileNodeId && fileNodeId !== event.nodeId) {
        for (const edge of visibleEdges) {
          if ((edge.source === fileNodeId && edge.target === event.nodeId) || (edge.source === event.nodeId && edge.target === fileNodeId)) ids.add(edge.id);
        }
      }
    }
  }
  return [...ids];
}

function nodeIdsByBackingFile(pipeline: AgentPipeline): Map<string, string> {
  return new Map(pipeline.nodes.flatMap((node) => {
    const file = nodeBackingFile(node);
    return file ? [[normalizePath(file), node.id] as const] : [];
  }));
}

function artifactNodeIdsByPath(pipeline: AgentPipeline): Map<string, string> {
  return new Map(pipeline.nodes.filter((node) => node.type === 'artifact').map((node) => [normalizePath(node.path), node.id]));
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function sourceSummary(watchingSources: ActivitySourceRuntimeState[], degradedSources: ActivitySourceRuntimeState[]): string {
  if (watchingSources.length) {
    const primary = watchingSources.slice(0, 2).map((source) => source.label).join(', ');
    const suffix = watchingSources.length > 2 ? ` +${watchingSources.length - 2}` : '';
    return `${primary}${suffix}`;
  }
  if (degradedSources.length) return `${degradedSources.length} source${degradedSources.length === 1 ? '' : 's'} need setup`;
  return 'No active sources';
}

function compactToolName(toolName: string): string {
  const normalized = toolName.replace(/^tool[_/-]/, '').replace(/^copilot[_/-]/, '');
  return normalized.split('/').at(-1)?.replace(/_/g, ' ') || normalized.replace(/_/g, ' ');
}

function writesArtifact(node: PipelineNode, path: string): boolean {
  const normalizedPath = normalizePath(path);
  if ('outputs' in node && node.outputs?.some((output) => normalizePath(output) === normalizedPath)) return true;
  if ('artifactUsages' in node && node.artifactUsages?.some((usage) => normalizePath(usage.path) === normalizedPath && (usage.action === 'write' || usage.action === 'append'))) return true;
  return false;
}
