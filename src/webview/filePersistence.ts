import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { generateFiles } from '../pipeline/generators';
import { PIPELINE_FILE_PATH } from '../pipeline/paths';
import { AgentPipeline } from '../pipeline/types';
import { stringifyViewState } from '../pipeline/viewState';

export type AgentFlowLog = (message: string) => void;

export interface FilePersistenceResult {
  written: string[];
  removed: string[];
}

export async function writePipelineViewState(workspace: string, pipeline: AgentPipeline, log?: AgentFlowLog): Promise<FilePersistenceResult> {
  const target = path.join(workspace, PIPELINE_FILE_PATH);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, stringifyViewState(pipeline), 'utf8');
  log?.(`wrote ${PIPELINE_FILE_PATH}`);
  return { written: [target], removed: [] };
}

export async function writeGeneratedFiles(workspace: string, pipeline: AgentPipeline, previousPipeline?: AgentPipeline, log?: AgentFlowLog): Promise<FilePersistenceResult> {
  const written: string[] = [];
  const removed: string[] = [];
  const nextFiles = generateFiles(pipeline).filter((file) => file.kind !== 'pipeline');
  const nextPaths = new Set(nextFiles.map((file) => file.path));
  for (const file of previousPipeline ? generateFiles(previousPipeline).filter((item) => item.kind !== 'pipeline') : []) {
    if (nextPaths.has(file.path)) continue;
    const target = path.join(workspace, file.path);
    await fs.rm(target, { force: true });
    removed.push(target);
    log?.(`removed stale ${file.path}`);
  }
  for (const file of nextFiles) {
    const target = path.join(workspace, file.path);
    if (await readExistingFile(target) === file.content) {
      log?.(`unchanged ${file.path}`);
      continue;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content, 'utf8');
    written.push(target);
    log?.(`wrote ${file.path}`);
  }
  return { written, removed };
}

async function readExistingFile(file: string): Promise<string | undefined> {
  try { return await fs.readFile(file, 'utf8'); } catch { return undefined; }
}
