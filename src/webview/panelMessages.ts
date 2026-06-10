import { parsePipeline } from '../pipeline/parser';
import { normalizePipelineAgentReferences } from '../pipeline/referenceResolver';
import { AgentPipeline } from '../pipeline/types';
import { generateFiles } from '../pipeline/generators';

export interface SavePipelineMessage {
  command: 'savePipeline';
  pipeline: unknown;
  selectedId?: string;
}

export interface WriteMarkdownFilesMessage {
  command: 'writeMarkdownFiles';
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

export interface WriteMarkdownFilesDependencies {
  message: WriteMarkdownFilesMessage;
  workspace: string;
  writeMarkdownFiles(workspace: string, pipeline: AgentPipeline): Promise<void>;
  postState(pipeline: AgentPipeline, selectedId?: string): Promise<void>;
  confirmWrite(fileCount: number): Promise<boolean>;
  showWrittenMessage(fileCount: number): Promise<void>;
}

export async function handleWriteMarkdownFilesMessage(dependencies: WriteMarkdownFilesDependencies): Promise<AgentPipeline | undefined> {
  const pipeline = normalizePipelineAgentReferences(parsePipeline(dependencies.message.pipeline));
  const fileCount = generateFiles(pipeline).filter((file) => file.kind !== 'pipeline').length;
  if (!await dependencies.confirmWrite(fileCount)) return undefined;
  await dependencies.writeMarkdownFiles(dependencies.workspace, pipeline);
  await dependencies.postState(pipeline, dependencies.message.selectedId);
  await dependencies.showWrittenMessage(fileCount);
  return pipeline;
}
