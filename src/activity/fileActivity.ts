import * as path from 'node:path';
import { AgentPipeline, PipelineNode } from '../pipeline/types';
import { AgentFlowActivityInput } from './types';
import { nodeBackingFile } from './store';

export function activityInputsForChangedFiles(pipeline: AgentPipeline, files: string[], workspace?: string): AgentFlowActivityInput[] {
  const nodesByFile = new Map<string, PipelineNode>();
  const artifactNodesByPath = new Map<string, PipelineNode>();
  for (const node of pipeline.nodes) {
    const backingFile = nodeBackingFile(node);
    if (backingFile) nodesByFile.set(normalizeRelativePath(backingFile), node);
    if (node.type === 'artifact') artifactNodesByPath.set(normalizeRelativePath(node.path), node);
  }

  const inputs: AgentFlowActivityInput[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const rel = normalizeChangedPath(file, workspace);
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    if (!rel.startsWith('.github/')) continue;

    const artifactNode = artifactNodesByPath.get(rel);
    if (artifactNode) {
      const producer = findArtifactProducer(pipeline, rel);
      inputs.push({
        sessionId: 'filesystem',
        phase: 'artifact',
        nodeId: producer?.id ?? artifactNode.id,
        artifactPath: rel,
        summary: `Updated artifact ${rel}`,
        severity: 'info'
      });
      continue;
    }

    const node = nodesByFile.get(rel);
    if (!node) continue;
    inputs.push({
      sessionId: 'filesystem',
      phase: 'file',
      nodeId: node.id,
      nodeFile: rel,
      summary: `Updated ${rel}`,
      severity: 'info'
    });
  }
  return inputs;
}

function findArtifactProducer(pipeline: AgentPipeline, artifactPath: string): PipelineNode | undefined {
  return pipeline.nodes.find((node) => {
    if (node.type === 'agent' && node.outputs?.map(normalizeRelativePath).includes(artifactPath)) return true;
    if ((node.type === 'agent' || node.type === 'prompt' || node.type === 'instruction' || node.type === 'skill') && node.artifactUsages?.some((usage) => normalizeRelativePath(usage.path) === artifactPath && (usage.action === 'write' || usage.action === 'append'))) return true;
    return false;
  });
}

function normalizeChangedPath(file: string, workspace?: string): string {
  const normalized = file.replace(/\\/g, '/');
  if (workspace) {
    const rel = path.relative(workspace, file).replace(/\\/g, '/');
    if (rel && !rel.startsWith('..')) return normalizeRelativePath(rel);
  }
  const marker = '/.github/';
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex >= 0) return normalizeRelativePath(normalized.slice(markerIndex + 1));
  return normalizeRelativePath(normalized);
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}
