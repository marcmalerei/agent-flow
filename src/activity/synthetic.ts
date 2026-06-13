import { AgentPipeline, PipelineNode } from '../pipeline/types';
import { nodeBackingFile } from './store';
import { AgentFlowActivityInput } from './types';

export function createSyntheticActivity(pipeline: AgentPipeline, sessionId = 'demo'): AgentFlowActivityInput[] {
  const events: AgentFlowActivityInput[] = [];
  const firstNode = pipeline.nodes[0];
  if (firstNode) {
    events.push({ sessionId, nodeId: firstNode.id, phase: 'started', summary: `Started ${firstNode.label}.` });
    const file = nodeBackingFile(firstNode);
    if (file) events.push({ sessionId, nodeFile: file, phase: 'file', summary: `Read ${file}` });
  }

  for (const handoff of agentHandoffs(pipeline).slice(0, 3)) {
    events.push({
      sessionId,
      nodeId: handoff.source,
      targetNodeId: handoff.target,
      phase: 'handoff',
      summary: `Moved work from ${handoff.source} to ${handoff.target}.`
    });
  }

  const artifact = firstArtifactActivity(pipeline);
  if (artifact) {
    events.push({
      sessionId,
      nodeId: artifact.nodeId,
      artifactPath: artifact.path,
      phase: 'artifact',
      summary: `Updated artifact ${artifact.path}.`
    });
  }

  if (firstNode) events.push({ sessionId, nodeId: firstNode.id, phase: 'completed', summary: `Completed ${firstNode.label}.` });
  return events;
}

function agentHandoffs(pipeline: AgentPipeline): Array<{ source: string; target: string }> {
  const nodeIds = new Set(pipeline.nodes.map((node) => node.id));
  const handoffs: Array<{ source: string; target: string }> = [];
  for (const edge of pipeline.edges) {
    if (nodeIds.has(edge.from) && nodeIds.has(edge.to)) handoffs.push({ source: edge.from, target: edge.to });
  }
  for (const node of pipeline.nodes) {
    if (node.type !== 'agent' && node.type !== 'prompt') continue;
    const target = node.type === 'prompt' ? node.startAgent : node.calls?.[0] ?? node.handoffs?.[0]?.agent;
    if (target && nodeIds.has(target) && !handoffs.some((handoff) => handoff.source === node.id && handoff.target === target)) handoffs.push({ source: node.id, target });
  }
  return handoffs;
}

function firstArtifactActivity(pipeline: AgentPipeline): { nodeId: string; path: string } | undefined {
  for (const node of pipeline.nodes) {
    const path = artifactOutputPath(node);
    if (path) return { nodeId: node.id, path };
  }
  return undefined;
}

function artifactOutputPath(node: PipelineNode): string | undefined {
  if (node.type === 'agent' && node.outputs?.[0]) return node.outputs[0];
  if ((node.type === 'agent' || node.type === 'prompt' || node.type === 'instruction' || node.type === 'skill')) {
    return node.artifactUsages?.find((usage) => usage.action === 'write' || usage.action === 'append')?.path;
  }
  return undefined;
}
