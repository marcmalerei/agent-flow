import { AgentPipeline } from '../pipeline/types';
import { AgentFlowActivityEvent } from './types';

export interface ActivityMetricsSummary {
  sessions: number;
  activeNodes: number;
  completed: number;
  failed: number;
  fileReads: number;
  fileWrites: number;
  artifactsTouched: number;
  tokenEstimate: number;
}

export interface NodeActivityMetric {
  nodeId: string;
  label: string;
  eventCount: number;
  completedCount: number;
  failedCount: number;
  tokenEstimate: number;
  lastActivity?: string;
}

export interface FileActivityMetric {
  path: string;
  reads: number;
  writes: number;
  events: number;
  tokens: number;
  latestTimestamp?: string;
  nodeIds: string[];
}

export interface ActivityMetrics {
  summary: ActivityMetricsSummary;
  nodes: NodeActivityMetric[];
  files: FileActivityMetric[];
}

export function aggregateActivityMetrics(pipeline: AgentPipeline, events: readonly AgentFlowActivityEvent[]): ActivityMetrics {
  const sessions = new Set<string>();
  const activeNodes = new Set<string>();
  const artifactsTouched = new Set<string>();
  const nodeMetrics = new Map<string, NodeActivityMetric>();
  const fileMetrics = new Map<string, MutableFileActivityMetric>();
  let completed = 0;
  let failed = 0;
  let fileReads = 0;
  let fileWrites = 0;
  let tokenEstimate = 0;
  const labels = new Map(pipeline.nodes.map((node) => [node.id, node.label]));

  for (const event of events) {
    sessions.add(event.sessionId);
    tokenEstimate += event.tokenEstimate ?? 0;
    if (event.phase === 'completed') completed += 1;
    if (event.phase === 'failed' || event.severity === 'error') failed += 1;

    if (event.nodeId) {
      activeNodes.add(event.nodeId);
      const node = nodeMetrics.get(event.nodeId) ?? {
        nodeId: event.nodeId,
        label: labels.get(event.nodeId) ?? event.nodeId,
        eventCount: 0,
        completedCount: 0,
        failedCount: 0,
        tokenEstimate: 0,
        lastActivity: undefined
      };
      node.eventCount += 1;
      node.tokenEstimate += event.tokenEstimate ?? 0;
      if (event.phase === 'completed') node.completedCount += 1;
      if (event.phase === 'failed' || event.severity === 'error') node.failedCount += 1;
      node.lastActivity = later(node.lastActivity, event.timestamp);
      nodeMetrics.set(event.nodeId, node);
    }

    const filePath = event.artifactPath ?? event.nodeFile;
    if (!filePath) continue;
    if (event.artifactPath) artifactsTouched.add(event.artifactPath);
    const action = eventAction(event);
    if (action === 'read') fileReads += 1;
    if (action === 'write') fileWrites += 1;
    const file = fileMetrics.get(filePath) ?? { path: filePath, reads: 0, writes: 0, events: 0, tokens: 0, latestTimestamp: undefined, nodeIds: new Set<string>() };
    file.events += 1;
    file.tokens += event.tokenEstimate ?? 0;
    file.latestTimestamp = later(file.latestTimestamp, event.timestamp);
    if (event.nodeId) file.nodeIds.add(event.nodeId);
    if (action === 'read') file.reads += 1;
    if (action === 'write') file.writes += 1;
    fileMetrics.set(filePath, file);
  }

  return {
    summary: {
      sessions: sessions.size,
      activeNodes: activeNodes.size,
      completed,
      failed,
      fileReads,
      fileWrites,
      artifactsTouched: artifactsTouched.size,
      tokenEstimate
    },
    nodes: [...nodeMetrics.values()].sort((left, right) => right.eventCount - left.eventCount || Date.parse(right.lastActivity ?? '') - Date.parse(left.lastActivity ?? '') || left.label.localeCompare(right.label)),
    files: [...fileMetrics.values()]
      .map((file) => ({ ...file, nodeIds: [...file.nodeIds].sort((a, b) => a.localeCompare(b)) }))
      .sort((left, right) => right.events - left.events || right.tokens - left.tokens || left.path.localeCompare(right.path))
  };
}

interface MutableFileActivityMetric {
  path: string;
  reads: number;
  writes: number;
  events: number;
  tokens: number;
  latestTimestamp?: string;
  nodeIds: Set<string>;
}

function eventAction(event: AgentFlowActivityEvent): 'read' | 'write' | undefined {
  const text = `${event.phase} ${event.toolName ?? ''} ${event.summary}`.toLowerCase();
  if (event.phase === 'artifact') {
    if (/\b(write|append|edit|update|create|save)\b/.test(text)) return 'write';
    if (/\b(read|open|load)\b/.test(text)) return 'read';
  }
  if (/\b(write|append|edit|update|create|save)\b/.test(text)) return 'write';
  if (/\b(read|open|load)\b/.test(text)) return 'read';
  return undefined;
}

function later(left: string | undefined, right: string): string {
  if (!left) return right;
  return Date.parse(right) > Date.parse(left) ? right : left;
}
