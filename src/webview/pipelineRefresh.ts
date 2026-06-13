import { loadOrInferPipeline } from '../pipeline/scanner';
import { AgentPipeline } from '../pipeline/types';

export interface PipelineRefreshResult {
  pipeline: AgentPipeline;
  changed: boolean;
}

export async function refreshPipelineAfterWorkspaceChange(
  workspace: string,
  current: AgentPipeline,
  infer: (workspace: string) => Promise<AgentPipeline> = loadOrInferPipeline
): Promise<PipelineRefreshResult> {
  const next = await infer(workspace);
  if (current.nodes.length > 0 && next.nodes.length === 0) {
    return { pipeline: current, changed: false };
  }
  return { pipeline: next, changed: true };
}
