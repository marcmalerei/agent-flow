import { parsePipeline } from '../pipeline/parser';
import { normalizePipelineAgentReferences } from '../pipeline/referenceResolver';
import { AgentPipeline } from '../pipeline/types';

export interface SavePipelineMessage {
  command: 'savePipeline';
  pipeline: unknown;
  selectedId?: string;
}

export interface SavePipelineDependencies {
  message: SavePipelineMessage;
  workspace: string;
  writePipeline(workspace: string, pipeline: AgentPipeline): Promise<void>;
  postState(pipeline: AgentPipeline, selectedId?: string): Promise<void>;
  showSavedMessage(): Promise<void>;
}

export async function handleSavePipelineMessage(dependencies: SavePipelineDependencies): Promise<AgentPipeline> {
  const pipeline = normalizePipelineAgentReferences(parsePipeline(dependencies.message.pipeline));
  await dependencies.writePipeline(dependencies.workspace, pipeline);
  await dependencies.postState(pipeline, dependencies.message.selectedId);
  await dependencies.showSavedMessage();
  return pipeline;
}
