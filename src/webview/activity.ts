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

export function recentActivityEvents(events: AgentFlowActivityEvent[], now = Date.now(), ttlMs = 15_000): AgentFlowActivityEvent[] {
  return events.filter((event) => {
    const timestamp = Date.parse(event.timestamp);
    return !Number.isNaN(timestamp) && now - timestamp <= ttlMs;
  });
}

export function activeEdgeIds(pipeline: AgentPipeline, events: AgentFlowActivityEvent[]): string[] {
  const ids = new Set<string>();
  const nodesById = new Map(pipeline.nodes.map((node) => [node.id, node]));
  const artifactByPath = new Map(pipeline.nodes.filter((node) => node.type === 'artifact').map((node) => [node.path, node.id]));
  const instructionByFile = new Map(pipeline.nodes.filter((node) => node.type === 'instruction').map((node) => [node.instructionFile ?? `.github/instructions/${node.id}.instructions.md`, node.id]));
  const nodeIdByFile = new Map(pipeline.nodes.flatMap((node) => {
    const file = nodeBackingFile(node);
    return file ? [[file, node.id] as const] : [];
  }));
  const visibleEdges = deriveVisibleFlowEdges(pipeline);

  for (const event of events) {
    if (event.nodeId && event.targetNodeId) {
      for (const edge of pipeline.edges) {
        if (edge.from === event.nodeId && edge.to === event.targetNodeId) ids.add(edge.id);
      }
    }
    if (event.nodeId && event.artifactPath) {
      const artifactNodeId = artifactByPath.get(event.artifactPath);
      const node = nodesById.get(event.nodeId);
      if (artifactNodeId && node) {
        if (writesArtifact(node, event.artifactPath)) ids.add(`ref:artifact-output:${event.nodeId}:${artifactNodeId}`);
        else ids.add(`ref:artifact-input:${artifactNodeId}:${event.nodeId}`);
      }
    }
    if (event.nodeId && event.nodeFile) {
      const artifactNodeId = artifactByPath.get(event.nodeFile);
      const eventNode = nodesById.get(event.nodeId);
      if (artifactNodeId && eventNode) {
        if (writesArtifact(eventNode, event.nodeFile)) ids.add(`ref:artifact-output:${event.nodeId}:${artifactNodeId}`);
        else ids.add(`ref:artifact-input:${artifactNodeId}:${event.nodeId}`);
      }
      const instructionNodeId = instructionByFile.get(event.nodeFile);
      if (instructionNodeId && instructionNodeId !== event.nodeId) ids.add(`ref:agent.instructionRefs:${instructionNodeId}:${event.nodeId}`);
      const fileNodeId = nodeIdByFile.get(event.nodeFile);
      if (fileNodeId && fileNodeId !== event.nodeId) {
        for (const edge of visibleEdges) {
          if ((edge.source === fileNodeId && edge.target === event.nodeId) || (edge.source === event.nodeId && edge.target === fileNodeId)) ids.add(edge.id);
        }
      }
    }
  }
  return [...ids];
}

function writesArtifact(node: PipelineNode, path: string): boolean {
  if ('outputs' in node && node.outputs?.includes(path)) return true;
  if ('artifactUsages' in node && node.artifactUsages?.some((usage) => usage.path === path && (usage.action === 'write' || usage.action === 'append'))) return true;
  return false;
}
