import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AgentPipeline } from '../pipeline/types';
import { ActivityStore } from './store';
import { parseClaudeCodeHookLogContent } from './claudeCodeHooks';

export interface ClaudeCodeHookStatus {
  enabled: boolean;
  configuredPath?: string;
  discoveredFiles: string[];
  state: 'disabled' | 'no-path-configured' | 'path-not-found' | 'watching';
  detail: string;
}

export interface ClaudeCodeHookAdapterOptions {
  pipelineProvider(): Promise<AgentPipeline | undefined>;
  workspaceProvider(): string | undefined;
}

export function startClaudeCodeHookAdapter(store: ActivityStore, options: ClaudeCodeHookAdapterOptions, log?: (message: string) => void): vscode.Disposable {
  const controller = new ClaudeCodeHookAdapter(store, options, log);
  controller.start().catch((error) => log?.(`Claude Code hook adapter failed to start: ${(error as Error).message}`));
  const configuration = vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration('agentflow.activity.claudeCodeHooks')) return;
    controller.restart().catch((error) => log?.(`Claude Code hook adapter failed to restart: ${(error as Error).message}`));
  });
  return new vscode.Disposable(() => {
    configuration.dispose();
    controller.dispose();
  });
}

class ClaudeCodeHookAdapter {
  private watcher?: vscode.FileSystemWatcher;
  private offsets = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private root?: string;

  constructor(private readonly store: ActivityStore, private readonly options: ClaudeCodeHookAdapterOptions, private readonly log?: (message: string) => void) {}

  async start(): Promise<void> {
    this.disposeWatcher();
    const status = await getClaudeCodeHookStatus();
    if (!status.enabled) {
      this.log?.('Claude Code hook adapter disabled.');
      return;
    }
    if (status.state !== 'watching' || !status.configuredPath) {
      this.log?.(status.detail);
      return;
    }
    this.root = status.configuredPath;
    await this.scanRoot(status.discoveredFiles);
    const schedule = () => this.scheduleScan();
    this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this.root, '**/*.{json,jsonl,ndjson,log}'));
    this.watcher.onDidCreate(schedule);
    this.watcher.onDidChange(schedule);
    this.watcher.onDidDelete(schedule);
    this.log?.(`Claude Code hook adapter watching ${this.root}.`);
  }

  async restart(): Promise<void> {
    this.disposeWatcher();
    this.offsets.clear();
    await this.start();
  }

  dispose(): void {
    this.disposeWatcher();
    if (this.timer) clearTimeout(this.timer);
  }

  private disposeWatcher(): void {
    this.watcher?.dispose();
    this.watcher = undefined;
    this.root = undefined;
  }

  private scheduleScan(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      getClaudeCodeHookStatus()
        .then((status) => this.scanRoot(status.discoveredFiles))
        .catch((error) => this.log?.(`Claude Code hook scan failed: ${(error as Error).message}`));
    }, 150);
  }

  private async scanRoot(files: string[]): Promise<void> {
    const pipeline = await this.options.pipelineProvider();
    const workspace = this.options.workspaceProvider();
    for (const file of files) await this.importFile(file, workspace, pipeline);
  }

  private async importFile(file: string, workspace: string | undefined, pipeline: AgentPipeline | undefined): Promise<void> {
    try {
      const content = await fs.readFile(file, 'utf8');
      const previousOffset = this.offsets.get(file) ?? 0;
      const incremental = /\.(jsonl|ndjson|log)$/i.test(file);
      const nextContent = incremental ? content.slice(previousOffset) : previousOffset > 0 ? '' : content;
      this.offsets.set(file, content.length);
      if (!nextContent.trim()) return;
      const result = parseClaudeCodeHookLogContent(nextContent, { sourceFile: file, workspace, pipeline });
      for (const event of result.events) this.store.append(event);
      for (const diagnostic of result.diagnostics) this.log?.(diagnostic);
    } catch (error) {
      this.log?.(`Claude Code hook import failed for ${file}: ${(error as Error).message}`);
    }
  }
}

export async function getClaudeCodeHookStatus(): Promise<ClaudeCodeHookStatus> {
  const config = vscode.workspace.getConfiguration('agentflow.activity.claudeCodeHooks');
  const enabled = config.get<boolean>('enabled') ?? false;
  const configuredPath = config.get<string>('dataPath')?.trim() || undefined;
  if (!enabled) return { enabled, configuredPath, discoveredFiles: [], state: 'disabled', detail: 'Claude Code hook activity import is disabled.' };
  if (!configuredPath) return { enabled, configuredPath, discoveredFiles: [], state: 'no-path-configured', detail: 'Set agentflow.activity.claudeCodeHooks.dataPath to a folder where Claude Code hooks write JSONL activity.' };
  const root = path.resolve(configuredPath);
  if (!(await isDirectory(root))) return { enabled, configuredPath: root, discoveredFiles: [], state: 'path-not-found', detail: `Claude Code hook activity folder does not exist: ${root}.` };
  const discoveredFiles = await listHookFiles(root);
  return { enabled, configuredPath: root, discoveredFiles, state: 'watching', detail: `Watching ${root} for Claude Code hook activity${discoveredFiles.length ? ` (${discoveredFiles.length} existing file${discoveredFiles.length === 1 ? '' : 's'})` : ''}.` };
}

async function isDirectory(folder: string): Promise<boolean> {
  try {
    return (await fs.stat(folder)).isDirectory();
  } catch {
    return false;
  }
}

async function listHookFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(folder: string): Promise<void> {
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = await fs.readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(folder, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (/\.(jsonl?|ndjson|log)$/i.test(entry.name)) files.push(fullPath);
    }
  }
  await visit(root);
  return files.sort();
}

