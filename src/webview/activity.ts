import { AgentFlowActivityEvent, NodeActivitySummary } from '../activity/types';
import { AgentPipeline, PipelineNode } from '../pipeline/types';
import { nodeBackingFile } from '../activity/store';
import { deriveVisibleFlowEdges } from './graph';

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

function writesArtifact(node: PipelineNode, path: string): boolean {
  const normalizedPath = normalizePath(path);
  if ('outputs' in node && node.outputs?.some((output) => normalizePath(output) === normalizedPath)) return true;
  if ('artifactUsages' in node && node.artifactUsages?.some((usage) => normalizePath(usage.path) === normalizedPath && (usage.action === 'write' || usage.action === 'append'))) return true;
  return false;
}
