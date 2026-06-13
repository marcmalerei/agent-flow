import * as vscode from 'vscode';
import * as path from 'node:path';
import { countCopilotInstructionLines, loadOrInferPipeline } from '../pipeline/scanner';
import { validatePipeline } from '../pipeline/validator';
import { calculateRiskScore } from '../pipeline/riskScore';
import { generateFiles } from '../pipeline/generators';
import { AgentPipeline } from '../pipeline/types';
import { buildToolOptionGroups, normalizePipelineToolsForOptions } from './toolOptions';
import { handlePersistPipelineMessage, handleSavePipelineMessage, handleWriteMarkdownFilesMessage } from './panelMessages';
import { coerceFlowLayout } from './flowLayout';
import { AgentFlowLog, writeGeneratedFiles } from './filePersistence';
import { FileWatchSuppression } from './fileWatchSuppression';
import { PipelineRefreshCoordinator, refreshPipelineAfterWorkspaceChange } from './pipelineRefresh';
import { ActivityStore } from '../activity/store';
import { getCopilotDebugLogStatus } from '../activity/copilotDebugLogAdapter';
import { activityInputsForChangedFiles } from '../activity/fileActivity';
import { resolveActivityEventsForPipeline } from './activity';

export interface AgentFlowPanelSnapshot {
  open: boolean;
  nodeIds: string[];
  nodeCount: number;
  edgeCount: number;
  selectedId?: string;
  lastReason: string;
  updatedAt: string;
}

let latestPanelSnapshot: AgentFlowPanelSnapshot = {
  open: false,
  nodeIds: [],
  nodeCount: 0,
  edgeCount: 0,
  lastReason: 'not-opened',
  updatedAt: new Date(0).toISOString()
};

export function getLatestPipelinePanelSnapshot(): AgentFlowPanelSnapshot {
  return latestPanelSnapshot;
}

export async function openPipelinePanel(context: vscode.ExtensionContext, activityStore = new ActivityStore()): Promise<void> {
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspace) { vscode.window.showErrorMessage('Open a workspace folder before opening Agent Flow.'); return; }
  const output = vscode.window.createOutputChannel('Agent Flow');
  const log: AgentFlowLog = (message) => output.appendLine(`[${new Date().toISOString()}] ${message}`);
  const selfWrites = new FileWatchSuppression();
  const refreshCoordinator = new PipelineRefreshCoordinator();
  log(`opening pipeline panel for ${workspace}`);
  let pipeline = await loadOrInferPipeline(workspace);
  let selectedId: string | undefined;
  updatePanelSnapshot(pipeline, selectedId, 'opened');
  const panel: vscode.WebviewPanel = vscode.window.createWebviewPanel('agentflow.pipeline', 'Agent Flow Pipeline', vscode.ViewColumn.One, {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'webview-dist'))]
  });
  panel.webview.html = html(panel.webview, context, await buildState(workspace, pipeline, activityStore));
  const activitySubscription = activityStore.subscribe((activityEvents) => {
    panel.webview.postMessage({ command: 'activityUpdated', activityEvents: resolveActivityEventsForPipeline(pipeline, activityEvents) });
  });
  const configurationListener = vscode.workspace.onDidChangeConfiguration(async (event) => {
    if (!event.affectsConfiguration('agentflow.flow.layout') && !event.affectsConfiguration('agentflow.activity.copilotDebugLogs') && !event.affectsConfiguration('github.copilot.chat.agentDebugLog.fileLogging.enabled')) return;
    log('Agent Flow configuration changed');
    panel.webview.postMessage({ command: 'stateUpdated', state: await buildState(workspace, pipeline, activityStore), selectedId });
    panel.webview.postMessage({ command: 'refitFlow' });
  });
  const viewStateListener = panel.onDidChangeViewState((event) => {
    if (!event.webviewPanel.visible) return;
    log('pipeline panel became visible; requesting React Flow refit');
    panel.webview.postMessage({ command: 'refitFlow' });
  });
  const fileWatchers = createPipelineFileWatchers(workspace, async (changedFiles) => {
    log(`filesystem change detected; reloading pipeline (${changedFiles.length} changed path${changedFiles.length === 1 ? '' : 's'})`);
    const attempt = await refreshCoordinator.run(pipeline, (current) => refreshPipelineAfterWorkspaceChange(workspace, current));
    const refresh = attempt.result;
    if (attempt.stale) {
      log(`ignored stale filesystem refresh generation ${attempt.generation} after ${refresh.attempts} scan attempt${refresh.attempts === 1 ? '' : 's'}`);
      for (const activity of activityInputsForChangedFiles(pipeline, changedFiles, workspace)) activityStore.append(activity);
      return;
    }
    if (!refresh.changed) {
      log(`ignored ${refresh.reason} pipeline refresh after ${refresh.attempts} scan attempt${refresh.attempts === 1 ? '' : 's'}`);
      for (const activity of activityInputsForChangedFiles(pipeline, changedFiles, workspace)) activityStore.append(activity);
      return;
    }
    pipeline = refresh.pipeline;
    updatePanelSnapshot(pipeline, selectedId, 'filesystem-refresh');
    for (const activity of activityInputsForChangedFiles(pipeline, changedFiles, workspace)) activityStore.append(activity);
    log(`reloaded ${pipeline.nodes.length} nodes and ${pipeline.edges.length} edges after ${refresh.attempts} scan attempt${refresh.attempts === 1 ? '' : 's'}`);
    panel.webview.postMessage({ command: 'stateUpdated', state: await buildState(workspace, pipeline, activityStore), selectedId });
  }, log, selfWrites);
  panel.onDidDispose(() => {
    log('pipeline panel disposed');
    configurationListener.dispose();
    viewStateListener.dispose();
    activitySubscription.dispose();
    fileWatchers.dispose();
    latestPanelSnapshot = { ...latestPanelSnapshot, open: false, lastReason: 'disposed', updatedAt: new Date().toISOString() };
    output.dispose();
  });
  panel.webview.onDidReceiveMessage(async (message) => {
    try {
      if (message?.command === 'persistPipeline') {
        selectedId = typeof message.selectedId === 'string' ? message.selectedId : selectedId;
        const previousPipeline = pipeline;
        log(`persisting pipeline from webview; selected=${selectedId ?? 'none'}`);
        pipeline = await handlePersistPipelineMessage({
          message,
          workspace,
          previousPipeline,
          writePipeline: async () => {
            log('skipped flow JSON write; Markdown files are the source of truth');
          },
          writeMarkdownFiles: async (workspace, pipeline, previousPipeline) => {
            const result = await writeGeneratedFiles(workspace, pipeline, previousPipeline, log);
            selfWrites.markSelfWrites([...result.written, ...result.removed]);
          },
          postState: async () => {
            log('persisted webview changes without echoing stateUpdated');
          }
        });
        updatePanelSnapshot(pipeline, selectedId, 'persisted-webview');
        log(`persisted ${pipeline.nodes.length} nodes and ${pipeline.edges.length} edges`);
      }
      if (message?.command === 'savePipeline') {
        selectedId = typeof message.selectedId === 'string' ? message.selectedId : selectedId;
        log(`saving view state from webview; selected=${selectedId ?? 'none'}`);
        pipeline = await handleSavePipelineMessage({
          message,
          workspace,
          writePipeline: async () => {
            log('skipped flow JSON write; Markdown files are the source of truth');
          },
          postState: async (nextPipeline, selectedId) => {
            panel.webview.postMessage({ command: 'stateUpdated', state: await buildState(workspace, nextPipeline, activityStore), selectedId });
          },
          showSavedMessage: async () => {
            vscode.window.showInformationMessage('Agent Flow changes are saved to Markdown files.');
          }
        });
        updatePanelSnapshot(pipeline, selectedId, 'saved-view-state');
      }
      if (message?.command === 'writeMarkdownFiles') {
        selectedId = typeof message.selectedId === 'string' ? message.selectedId : selectedId;
        log(`manual generated file write requested; selected=${selectedId ?? 'none'}`);
        const nextPipeline = await handleWriteMarkdownFilesMessage({
          message,
          workspace,
          writeMarkdownFiles: async (workspace, pipeline) => {
            const result = await writeGeneratedFiles(workspace, pipeline, undefined, log);
            selfWrites.markSelfWrites([...result.written, ...result.removed]);
          },
          postState: async (nextPipeline, selectedId) => {
            panel.webview.postMessage({ command: 'stateUpdated', state: await buildState(workspace, nextPipeline, activityStore), selectedId });
          },
          confirmWrite: async (fileCount) => {
            const answer = await vscode.window.showWarningMessage(`Write ${fileCount} generated Agent Flow Markdown/artifact files? Existing files may be overwritten.`, { modal: true }, 'Write Files');
            return answer === 'Write Files';
          },
          showWrittenMessage: async (fileCount) => {
            vscode.window.showInformationMessage(`Agent Flow wrote ${fileCount} generated files.`);
          }
        });
        if (nextPipeline) pipeline = nextPipeline;
        updatePanelSnapshot(pipeline, selectedId, 'wrote-markdown-files');
      }
      if (message?.command === 'clearActivity') {
        log('clearing activity stream');
        activityStore.clear();
      }
    } catch (error) {
      log(`error while handling ${String(message?.command ?? 'unknown')} message: ${(error as Error).stack ?? (error as Error).message}`);
      vscode.window.showErrorMessage(`Agent Flow failed to update files: ${(error as Error).message}`);
    }
  });
}

function updatePanelSnapshot(pipeline: AgentPipeline, selectedId: string | undefined, reason: string): void {
  latestPanelSnapshot = {
    open: true,
    nodeIds: pipeline.nodes.map((node) => node.id),
    nodeCount: pipeline.nodes.length,
    edgeCount: pipeline.edges.length,
    selectedId,
    lastReason: reason,
    updatedAt: new Date().toISOString()
  };
}


function createPipelineFileWatchers(workspace: string, onRefresh: (changedFiles: string[]) => Promise<void>, log?: AgentFlowLog, selfWrites?: FileWatchSuppression): vscode.Disposable {
  const patterns = [
    '.agent-pipeline/pipeline.json',
    '.github/agents/**/*.agent.md',
    '.github/prompts/**/*.prompt.md',
    '.github/instructions/**/*.instructions.md',
    '.github/skills/**/SKILL.md',
    '.github/roles/**/*.md',
    '.github/artifacts/**/*.{md,json,txt}'
  ];
  const watchers = patterns.map((pattern) => vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspace, pattern)));
  log?.(`watching ${patterns.join(', ')}`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const pendingFiles = new Set<string>();
  const schedule = (uri: vscode.Uri) => {
    if (disposed) return;
    if (selfWrites?.consumeIfSelfWrite(uri.fsPath)) {
      log?.(`ignored self-triggered filesystem event for ${path.relative(workspace, uri.fsPath).replace(/\\/g, '/')}`);
      return;
    }
    pendingFiles.add(uri.fsPath);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      const changedFiles = [...pendingFiles];
      pendingFiles.clear();
      onRefresh(changedFiles).catch((error) => {
        log?.(`filesystem refresh failed: ${(error as Error).stack ?? (error as Error).message}`);
        vscode.window.showWarningMessage(`Agent Flow could not refresh the pipeline after file changes: ${(error as Error).message}`);
      });
    }, 600);
  };
  for (const watcher of watchers) {
    watcher.onDidCreate(schedule);
    watcher.onDidChange(schedule);
    watcher.onDidDelete(schedule);
  }
  return new vscode.Disposable(() => {
    disposed = true;
    if (timer) clearTimeout(timer);
    watchers.forEach((watcher) => watcher.dispose());
  });
}

async function buildState(workspace: string, pipeline: AgentPipeline, activityStore: ActivityStore): Promise<unknown> {
  const toolOptions = buildToolOptionGroups(vscode.lm.tools);
  const displayPipeline = normalizePipelineToolsForOptions(pipeline, toolOptions);
  const findings = validatePipeline(displayPipeline);
  const risk = calculateRiskScore(displayPipeline, { copilotInstructionsLines: await countCopilotInstructionLines(workspace) });
  return {
    pipeline: displayPipeline,
    findings,
    risk,
    generatedFiles: generateFiles(displayPipeline).map((file) => ({ path: file.path, kind: file.kind })),
    flowLayout: coerceFlowLayout(vscode.workspace.getConfiguration('agentflow.flow').get('layout')),
    toolOptions,
    activityEvents: resolveActivityEventsForPipeline(displayPipeline, activityStore.getEvents()),
    activitySources: {
      copilotDebugLogs: await getCopilotDebugLogStatus()
    }
  };
}

function html(webview: vscode.Webview, context: vscode.ExtensionContext, state: unknown): string {
  const script = webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'webview-dist/assets/main.js')));
  const css = webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'webview-dist/assets/main.css')));
  const nonce = String(Date.now());
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${css}">
<title>Agent Flow</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}">window.__AGENTFLOW_STATE__ = ${JSON.stringify(state).replace(/</g, '\\u003c')};</script>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}
