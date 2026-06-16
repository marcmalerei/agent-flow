import * as path from 'node:path';
import { parsePipeline } from '../pipeline/parser';
import { normalizePipelineAgentReferences } from '../pipeline/referenceResolver';
import { AgentPipeline } from '../pipeline/types';
import { generateFileForNode, generateFiles } from '../pipeline/generators';
import { normalizePipelineTools } from '../pipeline/toolNormalization';

export interface SavePipelineMessage {
  command: 'savePipeline';
  pipeline: unknown;
  selectedId?: string;
}

export interface PersistPipelineMessage {
  command: 'persistPipeline';
  pipeline: unknown;
  selectedId?: string;
}

export interface WriteMarkdownFilesMessage {
  command: 'writeMarkdownFiles';
  pipeline: unknown;
  selectedId?: string;
}

export interface OpenNodeDiffMessage {
  command: 'openNodeDiff';
  pipeline: unknown;
  nodeId?: string;
}

export interface SavePipelineDependencies {
  message: SavePipelineMessage;
  workspace: string;
  writePipeline(workspace: string, pipeline: AgentPipeline): Promise<void>;
  postState(pipeline: AgentPipeline, selectedId?: string): Promise<void>;
  showSavedMessage(): Promise<void>;
}

export async function handleSavePipelineMessage(dependencies: SavePipelineDependencies): Promise<AgentPipeline> {
  const pipeline = normalizePipelineTools(normalizePipelineAgentReferences(parsePipeline(dependencies.message.pipeline)));
  await dependencies.writePipeline(dependencies.workspace, pipeline);
  await dependencies.postState(pipeline, dependencies.message.selectedId);
  await dependencies.showSavedMessage();
  return pipeline;
}

export interface PersistPipelineDependencies {
  message: PersistPipelineMessage;
  workspace: string;
  writePipeline(workspace: string, pipeline: AgentPipeline): Promise<void>;
  writeMarkdownFiles(workspace: string, pipeline: AgentPipeline, previousPipeline?: AgentPipeline): Promise<void>;
  postState(pipeline: AgentPipeline, selectedId?: string): Promise<void>;
  previousPipeline?: AgentPipeline;
}

export async function handlePersistPipelineMessage(dependencies: PersistPipelineDependencies): Promise<AgentPipeline> {
  const pipeline = normalizePipelineTools(normalizePipelineAgentReferences(parsePipeline(dependencies.message.pipeline)));
  await dependencies.writePipeline(dependencies.workspace, pipeline);
  await dependencies.writeMarkdownFiles(dependencies.workspace, pipeline, dependencies.previousPipeline);
  await dependencies.postState(pipeline, dependencies.message.selectedId);
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
  const pipeline = normalizePipelineTools(normalizePipelineAgentReferences(parsePipeline(dependencies.message.pipeline)));
  const fileCount = generateFiles(pipeline).filter((file) => file.kind !== 'pipeline').length;
  if (!await dependencies.confirmWrite(fileCount)) return undefined;
  await dependencies.writeMarkdownFiles(dependencies.workspace, pipeline);
  await dependencies.postState(pipeline, dependencies.message.selectedId);
  await dependencies.showWrittenMessage(fileCount);
  return pipeline;
}

export interface OpenNodeDiffDependencies {
  message: OpenNodeDiffMessage;
  workspace: string;
  writeTempDraft(relativePath: string, content: string): Promise<string>;
  openDiff(left: string, right: string, title: string): Promise<void>;
  showErrorMessage(message: string): Promise<void>;
}

export async function handleOpenNodeDiffMessage(dependencies: OpenNodeDiffDependencies): Promise<void> {
  const pipeline = normalizePipelineTools(normalizePipelineAgentReferences(parsePipeline(dependencies.message.pipeline)));
  const nodeId = typeof dependencies.message.nodeId === 'string' ? dependencies.message.nodeId : '';
  const file = generateFileForNode(pipeline, nodeId);
  if (!file || file.kind === 'pipeline') {
    await dependencies.showErrorMessage('Agent Flow could not find a generated file for this node.');
    return;
  }
  const draftPath = await dependencies.writeTempDraft(file.path, file.content);
  await dependencies.openDiff(draftPath, path.resolve(dependencies.workspace, file.path), 'Agent Flow draft vs external file');
}
