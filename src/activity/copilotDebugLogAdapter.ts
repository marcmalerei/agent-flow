import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ActivityStore } from './store';
import { parseCopilotDebugLogContent } from './copilotDebugLogs';

export interface CopilotDebugLogStatus {
  enabled: boolean;
  copilotFileLoggingEnabled: boolean;
  configuredPath?: string;
  discoveredRoots: string[];
  state: 'disabled' | 'waiting-for-copilot-logging' | 'no-logs-found' | 'watching';
  detail: string;
}

export function startCopilotDebugLogAdapter(store: ActivityStore, log?: (message: string) => void): vscode.Disposable {
  const controller = new CopilotDebugLogAdapter(store, log);
  controller.start().catch((error) => log?.(`Copilot debug log adapter failed to start: ${(error as Error).message}`));
  const configuration = vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration('agentflow.activity.copilotDebugLogs')) return;
    controller.restart().catch((error) => log?.(`Copilot debug log adapter failed to restart: ${(error as Error).message}`));
  });
  return new vscode.Disposable(() => {
    configuration.dispose();
    controller.dispose();
  });
}

class CopilotDebugLogAdapter {
  private watchers: vscode.FileSystemWatcher[] = [];
  private offsets = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private roots: string[] = [];

  constructor(private readonly store: ActivityStore, private readonly log?: (message: string) => void) {}

  async start(): Promise<void> {
    this.disposeWatcher();
    const status = await getCopilotDebugLogStatus();
    if (!status.enabled) {
      this.log?.('Copilot debug log adapter disabled.');
      return;
    }
    if (!status.discoveredRoots.length) {
      this.log?.(status.detail);
      return;
    }
    this.roots = status.discoveredRoots;
    await this.scanRoots();
    const schedule = () => this.scheduleScan();
    this.watchers = this.roots.map((root) => {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/*.{json,jsonl}'));
      watcher.onDidCreate(schedule);
      watcher.onDidChange(schedule);
      watcher.onDidDelete(schedule);
      return watcher;
    });
    this.log?.(`Copilot debug log adapter watching ${this.roots.length} folder${this.roots.length === 1 ? '' : 's'}.`);
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
    for (const watcher of this.watchers) watcher.dispose();
    this.watchers = [];
    this.roots = [];
  }

  private scheduleScan(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.scanRoots().catch((error) => this.log?.(`Copilot debug log scan failed: ${(error as Error).message}`));
    }, 150);
  }

  private async scanRoots(): Promise<void> {
    for (const root of this.roots) {
      for (const file of await listDebugLogFiles(root)) {
        await this.importFile(file);
      }
    }
  }

  private async importFile(file: string): Promise<void> {
    const content = await fs.readFile(file, 'utf8');
    const previousOffset = this.offsets.get(file) ?? 0;
    const nextContent = file.endsWith('.jsonl') ? content.slice(previousOffset) : previousOffset > 0 ? '' : content;
    this.offsets.set(file, content.length);
    if (!nextContent.trim()) return;
    const result = parseCopilotDebugLogContent(nextContent, { sourceFile: file });
    for (const event of result.events) this.store.append(event);
    for (const diagnostic of result.diagnostics) this.log?.(diagnostic);
  }
}

export async function getCopilotDebugLogStatus(): Promise<CopilotDebugLogStatus> {
  const config = vscode.workspace.getConfiguration('agentflow.activity.copilotDebugLogs');
  const enabled = config.get<boolean>('enabled') ?? true;
  const configuredPath = config.get<string>('dataPath')?.trim() || undefined;
  const copilotFileLoggingEnabled = vscode.workspace.getConfiguration().get<boolean>('github.copilot.chat.agentDebugLog.fileLogging.enabled') ?? false;
  if (!enabled) {
    return { enabled, copilotFileLoggingEnabled, configuredPath, discoveredRoots: [], state: 'disabled', detail: 'Agent Flow debug-log activity import is disabled.' };
  }
  if (!configuredPath && !copilotFileLoggingEnabled) {
    return {
      enabled,
      copilotFileLoggingEnabled,
      configuredPath,
      discoveredRoots: [],
      state: 'waiting-for-copilot-logging',
      detail: 'Enable GitHub Copilot file logging to import Copilot debug activity.'
    };
  }
  const discoveredRoots = await resolveCopilotDebugLogRoots(configuredPath);
  if (!discoveredRoots.length) {
    return {
      enabled,
      copilotFileLoggingEnabled,
      configuredPath,
      discoveredRoots,
      state: 'no-logs-found',
      detail: configuredPath ? `No Copilot debug logs found under ${configuredPath}.` : 'No Copilot debug log folders found for this VS Code profile yet.'
    };
  }
  return {
    enabled,
    copilotFileLoggingEnabled,
    configuredPath,
    discoveredRoots,
    state: 'watching',
    detail: `Watching ${discoveredRoots.length} Copilot debug log folder${discoveredRoots.length === 1 ? '' : 's'}.`
  };
}

export async function resolveCopilotDebugLogRoots(configuredPath?: string): Promise<string[]> {
  const roots = configuredPath ? [path.resolve(configuredPath)] : defaultCopilotDebugLogSearchRoots();
  const found: string[] = [];
  for (const root of roots) {
    if (await isDirectory(root)) {
      const directDebugLogs = root.toLowerCase().endsWith('debug-logs') ? [root] : await findCopilotDebugLogFolders(root);
      found.push(...directDebugLogs);
    }
  }
  return [...new Set(found.map((item) => path.resolve(item)))];
}

function defaultCopilotDebugLogSearchRoots(): string[] {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return ['Code', 'Code - Insiders', 'VSCodium'].flatMap((app) => [
      path.join(home, 'Library', 'Application Support', app, 'User', 'workspaceStorage'),
      path.join(home, 'Library', 'Application Support', app, 'User', 'globalStorage')
    ]);
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
    return ['Code', 'Code - Insiders', 'VSCodium'].flatMap((app) => [
      path.join(appData, app, 'User', 'workspaceStorage'),
      path.join(appData, app, 'User', 'globalStorage')
    ]);
  }
  const configHome = process.env.XDG_CONFIG_HOME ?? path.join(home, '.config');
  return ['Code', 'Code - Insiders', 'VSCodium'].flatMap((app) => [
    path.join(configHome, app, 'User', 'workspaceStorage'),
    path.join(configHome, app, 'User', 'globalStorage')
  ]);
}

async function findCopilotDebugLogFolders(root: string): Promise<string[]> {
  const folders: string[] = [];
  async function visit(folder: string, depth: number): Promise<void> {
    if (depth > 5) return;
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = await fs.readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }
    const normalized = folder.toLowerCase().replace(/\\/g, '/');
    if (normalized.endsWith('/github.copilot-chat/debug-logs')) {
      folders.push(folder);
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      await visit(path.join(folder, entry.name), depth + 1);
    }
  }
  await visit(root, 0);
  return folders;
}

async function isDirectory(folder: string): Promise<boolean> {
  try {
    return (await fs.stat(folder)).isDirectory();
  } catch {
    return false;
  }
}

async function listDebugLogFiles(root: string): Promise<string[]> {
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
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (/\.(jsonl?|JSONL?)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }
  await visit(root);
  return files;
}
