import { AgentPipeline, PipelineNode, ValidationAction } from '../pipeline/types';

export interface DiagnosticQuickFixResult {
  pipeline: AgentPipeline;
  sectionId?: string;
  selectedId?: string;
}

export function applyDiagnosticQuickFix(pipeline: AgentPipeline, action: ValidationAction | undefined): DiagnosticQuickFixResult | undefined {
  if (!action || action.kind !== 'quickFix') return undefined;
  if (action.quickFixId === 'create-output-artifact' && action.nodeId) return createOutputArtifact(pipeline, action.nodeId, action.sectionId);
  return undefined;
}

function createOutputArtifact(pipeline: AgentPipeline, nodeId: string, sectionId?: string): DiagnosticQuickFixResult | undefined {
  const agent = pipeline.nodes.find((node): node is Extract<PipelineNode, { type: 'agent' }> => node.type === 'agent' && node.id === nodeId);
  if (!agent) return undefined;
  const artifactId = uniqueNodeId(pipeline, `${agent.id}-output`);
  const artifactPath = uniqueArtifactPath(pipeline, `.github/artifacts/${artifactId}.md`);
  const artifact: Extract<PipelineNode, { type: 'artifact' }> = {
    id: artifactId,
    type: 'artifact',
    label: artifactId.replace(/-/gu, ' '),
    path: artifactPath,
    position: { x: (agent.position?.x ?? 0) + 220, y: (agent.position?.y ?? 0) + 150 }
  };
  const nextAgent: typeof agent = {
    ...agent,
    outputs: [...new Set([...(agent.outputs ?? []), artifactPath])],
    artifactUsages: [
      ...(agent.artifactUsages ?? []).filter((usage) => usage.path !== artifactPath),
      { path: artifactPath, action: 'write', instruction: 'Write this node result to $artifact.' }
    ]
  };
  return {
    pipeline: {
      ...pipeline,
      nodes: pipeline.nodes.map((node) => node.id === agent.id ? nextAgent : node).concat(artifact)
    },
    selectedId: agent.id,
    sectionId
  };
}

function uniqueNodeId(pipeline: AgentPipeline, preferred: string): string {
  const existing = new Set(pipeline.nodes.map((node) => node.id));
  if (!existing.has(preferred)) return preferred;
  let suffix = 2;
  while (existing.has(`${preferred}-${suffix}`)) suffix += 1;
  return `${preferred}-${suffix}`;
}

function uniqueArtifactPath(pipeline: AgentPipeline, preferred: string): string {
  const existing = new Set(pipeline.nodes.filter((node): node is Extract<PipelineNode, { type: 'artifact' }> => node.type === 'artifact').map((node) => node.path));
  if (!existing.has(preferred)) return preferred;
  const extension = preferred.match(/\.[^/.]+$/u)?.[0] ?? '.md';
  const stem = preferred.slice(0, -extension.length);
  let suffix = 2;
  while (existing.has(`${stem}-${suffix}${extension}`)) suffix += 1;
  return `${stem}-${suffix}${extension}`;
}
