import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentPipeline } from '../pipeline/types';
import { ActivityStore } from './store';
import { createCodexRolloutParserState, CodexRolloutParserState, parseCodexRolloutChunk, recentCodexSessionDirs } from './codexRolloutLogs';

export interface CodexRolloutStatus {
  enabled: boolean;
  codexHome: string;
  discoveredFiles: string[];
  state: 'disabled' | 'no-workspace' | 'no-sessions-found' | 'watching';
  detail: string;
}

export interface CodexRolloutAdapterOptions {
  pipelineProvider(): Promise<AgentPipeline | undefined>;
  workspaceProvider(): string | undefined;
}

interface FileCursor {
  offset: number;
  state: CodexRolloutParserState;
}

export function startCodexRolloutAdapter(store: ActivityStore, options: CodexRolloutAdapterOptions, log?: (message: string) => void): vscode.Disposable {
  const controller = new CodexRolloutAdapter(store, options, log);
  controller.start().catch((error) => log?.(`Codex rollout adapter failed to start: ${(error as Error).message}`));
  const configuration = vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration('agentflow.activity.codexRollouts')) return;
    controller.restart().catch((error) => log?.(`Codex rollout adapter failed to restart: ${(error as Error).message}`));
  });
  return new vscode.Disposable(() => {
    configuration.dispose();
    controller.dispose();
  });
}

class CodexRolloutAdapter {
  private watchers: vscode.FileSystemWatcher[] = [];
  private cursors = new Map<string, FileCursor>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private sessionDirs: string[] = [];

  constructor(private readonly store: ActivityStore, private readonly options: CodexRolloutAdapterOptions, private readonly log?: (message: string) => void) {}

  async start(): Promise<void> {
    this.disposeWatchers();
    const status = await getCodexRolloutStatus(this.options.workspaceProvider());
    if (!status.enabled) {
      this.log?.('Codex rollout adapter disabled.');
      return;
    }
    if (status.state !== 'watching') {
      this.log?.(status.detail);
      return;
    }
    this.sessionDirs = recentCodexSessionDirs(status.codexHome);
    await this.scanFiles(status.discoveredFiles);
    const schedule = () => this.scheduleScan();
    this.watchers = this.sessionDirs.map((dir) => {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dir, 'rollout-*.jsonl'));
      watcher.onDidCreate(schedule);
      watcher.onDidChange(schedule);
      watcher.onDidDelete(schedule);
      return watcher;
    });
    this.log?.(`Codex rollout adapter watching ${status.discoveredFiles.length} rollout file${status.discoveredFiles.length === 1 ? '' : 's'}.`);
  }

  async restart(): Promise<void> {
    this.disposeWatchers();
    this.cursors.clear();
    await this.start();
  }

  dispose(): void {
    this.disposeWatchers();
    if (this.timer) clearTimeout(this.timer);
  }

  private disposeWatchers(): void {
    for (const watcher of this.watchers) watcher.dispose();
    this.watchers = [];
    this.sessionDirs = [];
  }

  private scheduleScan(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      getCodexRolloutStatus(this.options.workspaceProvider())
        .then((status) => this.scanFiles(status.discoveredFiles))
        .catch((error) => this.log?.(`Codex rollout scan failed: ${(error as Error).message}`));
    }, 150);
  }

  private async scanFiles(files: string[]): Promise<void> {
    const pipeline = await this.options.pipelineProvider();
    const workspace = this.options.workspaceProvider();
    for (const file of files) await this.importFile(file, workspace, pipeline);
  }

  private async importFile(file: string, workspace: string | undefined, pipeline: AgentPipeline | undefined): Promise<void> {
    let content: string;
    let size = 0;
    try {
      const stat = await fs.stat(file);
      size = stat.size;
      const cursor = this.cursors.get(file) ?? { offset: 0, state: createCodexRolloutParserState() };
      if (size < cursor.offset) {
        cursor.offset = 0;
        cursor.state = createCodexRolloutParserState();
      }
      content = await readFileSlice(file, cursor.offset);
      cursor.offset = size;
      this.cursors.set(file, cursor);
      if (!content) return;
      const result = parseCodexRolloutChunk(content, cursor.state, { sourceFile: file, workspace, pipeline });
      for (const event of result.events) this.store.append(event);
      for (const diagnostic of result.diagnostics) this.log?.(diagnostic);
    } catch (error) {
      this.log?.(`Codex rollout import failed for ${file}: ${(error as Error).message}`);
    }
  }
}

export async function getCodexRolloutStatus(workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath): Promise<CodexRolloutStatus> {
  const enabled = vscode.workspace.getConfiguration('agentflow.activity.codexRollouts').get<boolean>('enabled') ?? true;
  const codexHome = resolveCodexHome();
  if (!enabled) return { enabled, codexHome, discoveredFiles: [], state: 'disabled', detail: 'Codex rollout activity import is disabled.' };
  if (!workspace) return { enabled, codexHome, discoveredFiles: [], state: 'no-workspace', detail: 'Open a workspace to match Codex rollout sessions.' };
  const discoveredFiles = await discoverCodexRolloutFiles(codexHome, workspace);
  if (!discoveredFiles.length) {
    return { enabled, codexHome, discoveredFiles, state: 'no-sessions-found', detail: `No recent Codex rollout sessions found for ${workspace}.` };
  }
  return { enabled, codexHome, discoveredFiles, state: 'watching', detail: `Watching ${discoveredFiles.length} Codex rollout file${discoveredFiles.length === 1 ? '' : 's'}.` };
}

export async function discoverCodexRolloutFiles(codexHome: string, workspace: string, now = new Date()): Promise<string[]> {
  const files: string[] = [];
  for (const dir of recentCodexSessionDirs(codexHome, now)) {
    let entries: Awaited<ReturnType<typeof fs.readdir>>;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory() || !/^rollout-.+\.jsonl$/i.test(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (await rolloutMatchesWorkspace(file, workspace)) files.push(file);
    }
  }
  return files.sort();
}

function resolveCodexHome(): string {
  return process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex');
}

async function rolloutMatchesWorkspace(file: string, workspace: string): Promise<boolean> {
  const firstLine = await readFirstLine(file);
  if (!firstLine) return false;
  try {
    const row = JSON.parse(firstLine);
    const cwd = typeof row?.payload?.cwd === 'string' ? row.payload.cwd : undefined;
    if (!cwd) return false;
    const rel = path.relative(path.resolve(workspace), path.resolve(cwd));
    return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
  } catch {
    return false;
  }
}

async function readFirstLine(file: string): Promise<string | undefined> {
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(65_536);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (!bytesRead) return undefined;
    const slice = buffer.subarray(0, bytesRead);
    const newline = slice.indexOf(0x0a);
    return slice.subarray(0, newline >= 0 ? newline : slice.length).toString('utf8');
  } finally {
    await handle.close();
  }
}

async function readFileSlice(file: string, offset: number): Promise<string> {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (stat.size <= offset) return '';
    const buffer = Buffer.alloc(stat.size - offset);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}
