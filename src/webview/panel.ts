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
import { loadInitialPipelineWhenStable, PipelineRefreshCoordinator, refreshPipelineAfterWorkspaceChange } from './pipelineRefresh';
import { ActivityStore } from '../activity/store';
import { getCopilotDebugLogStatus } from '../activity/copilotDebugLogAdapter';
import { getCodexRolloutStatus } from '../activity/codexRolloutAdapter';
import { getClaudeCodeHookStatus } from '../activity/claudeCodeHookAdapter';
import { activityInputsForChangedFiles } from '../activity/fileActivity';
import { ActivitySourceRuntimeState, buildActivitySourceStatuses } from '../activity/sources';
import { resolveActivityEventsForPipeline } from './activity';
import { deriveNodeRuntimeState } from './nodeRuntimeState';

export interface AgentFlowPanelSnapshot {
  open: boolean;
  nodeIds: string[];
  nodeCount: number;
  edgeCount: number;
  stateVersion: number;
  webviewStateVersion?: number;
  webviewNodeIds?: string[];
  webviewRenderedNodeIds?: string[];
  webviewNodeCount?: number;
  webviewEdgeCount?: number;
  webviewRenderedNodeCount?: number;
  webviewVisibleNodeCount?: number;
  webviewCanvasWidth?: number;
  webviewCanvasHeight?: number;
  webviewWindowInnerHeight?: number;
  webviewVisualViewportHeight?: number;
  webviewRootHeight?: number;
  webviewAppHeight?: number;
  webviewGraphTransform?: string;
  webviewGraphBounds?: string;
  webviewRenderReason?: string;
  webviewReadyCount?: number;
  webviewReadyBootId?: string;
  webviewRuntimeError?: string;
  webviewRuntimeErrorDetail?: string;
  selectedId?: string;
  lastReason: string;
  updatedAt: string;
}

let latestPanelSnapshot: AgentFlowPanelSnapshot = {
  open: false,
  nodeIds: [],
  nodeCount: 0,
  edgeCount: 0,
  stateVersion: 0,
  lastReason: 'not-opened',
  updatedAt: new Date(0).toISOString()
};

const pipelineWatchPatterns = [
  '.agent-pipeline/pipeline.json',
  '.github/agents/**/*.agent.md',
  '.github/prompts/**/*.prompt.md',
  '.github/instructions/**/*.instructions.md',
  '.github/skills/**/SKILL.md',
  '.github/roles/**/*.md',
  '.github/artifacts/**/*.{md,json,txt}'
];

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
  const initial = await loadInitialPipelineWhenStable(workspace);
  if (initial.reason !== 'accepted') log(`opening with ${initial.pipeline.nodes.length} nodes after ${initial.attempts} initial scan attempts (${initial.reason})`);
  let pipeline = initial.pipeline;
  let selectedId: string | undefined;
  let stateVersion = 0;
  let disposed = false;
  let lastWebviewReadyBootId: string | undefined;
  const startupTimers = new Set<ReturnType<typeof setTimeout>>();
  const scheduleStartupTask = (delayMs: number, task: () => unknown): void => {
    const timer = setTimeout(() => {
      startupTimers.delete(timer);
      if (disposed) return;
      try {
        Promise.resolve(task()).catch((error) => log(`startup task failed: ${(error as Error).stack ?? (error as Error).message}`));
      } catch (error) {
        log(`startup task failed: ${(error as Error).stack ?? (error as Error).message}`);
      }
    }, delayMs);
    startupTimers.add(timer);
  };
  const markStateForPost = (reason: string): number => {
    stateVersion += 1;
    updatePanelSnapshot(pipeline, selectedId, reason, stateVersion);
    return stateVersion;
  };
  const postStateUpdated = async (reason: string, _refit = false): Promise<void> => {
    const version = markStateForPost(reason);
    panel.webview.postMessage({ command: 'stateUpdated', state: await buildState(workspace, pipeline, activityStore, version), selectedId });
  };
  const initialStateVersion = markStateForPost('opened');
  const panel: vscode.WebviewPanel = vscode.window.createWebviewPanel('agentflow.pipeline', 'Agent Flow Pipeline', vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'webview-dist'))]
  });
  panel.webview.html = html(panel.webview, context, await buildState(workspace, pipeline, activityStore, initialStateVersion));
  for (const delay of [500, 1_500, 3_000, 5_000]) {
    scheduleStartupTask(delay, async () => {
      if (pipeline.nodes.length > 0) return;
      const retry = await loadInitialPipelineWhenStable(workspace, loadOrInferPipeline, { maxAttempts: 2, retryDelayMs: 300 });
      if (retry.pipeline.nodes.length === 0) {
        log(`initial pipeline recovery still has no nodes after ${retry.attempts} scan attempt${retry.attempts === 1 ? '' : 's'} (${retry.reason})`);
        return;
      }
      pipeline = retry.pipeline;
      log(`initial pipeline recovery loaded ${pipeline.nodes.length} nodes after ${retry.attempts} scan attempt${retry.attempts === 1 ? '' : 's'}`);
      await postStateUpdated('initial-pipeline-recovery', true);
    });
  }
  const activitySubscription = activityStore.subscribe((activityEvents) => {
    panel.webview.postMessage({ command: 'activityUpdated', activityEvents: resolveActivityEventsForPipeline(pipeline, activityEvents) });
  });
  const configurationListener = vscode.workspace.onDidChangeConfiguration(async (event) => {
    if (!event.affectsConfiguration('agentflow.flow.layout') && !event.affectsConfiguration('agentflow.activity') && !event.affectsConfiguration('agentflow.debug') && !event.affectsConfiguration('github.copilot.chat.agentDebugLog.fileLogging.enabled')) return;
    log('Agent Flow configuration changed');
    await postStateUpdated('configuration-change', true);
  });
  const viewStateListener = panel.onDidChangeViewState((event) => {
    if (!event.webviewPanel.visible) return;
    log('pipeline panel became visible; posting latest state');
    setTimeout(() => {
      postStateUpdated('visible-refit', true)
        .catch((error) => log(`failed to refresh visible pipeline panel: ${(error as Error).stack ?? (error as Error).message}`));
    }, 100);
  });
  const fileWatchers = createPipelineFileWatchers(workspace, async (changedFiles) => {
    log(`filesystem change detected; reloading pipeline (${changedFiles.length} changed path${changedFiles.length === 1 ? '' : 's'})`);
    const attempt = await refreshCoordinator.run(pipeline, (current) => refreshPipelineAfterWorkspaceChange(workspace, current));
    const refresh = attempt.result;
    if (attempt.stale) {
      log(`ignored stale filesystem refresh generation ${attempt.generation} after ${refresh.attempts} scan attempt${refresh.attempts === 1 ? '' : 's'}`);
      for (const activity of activityInputsForChangedFiles(pipeline, changedFiles, workspace)) activityStore.append(activity);
      await postStateUpdated('filesystem-refresh-stale', true);
      return;
    }
    if (!refresh.changed) {
      log(`ignored ${refresh.reason} pipeline refresh after ${refresh.attempts} scan attempt${refresh.attempts === 1 ? '' : 's'}`);
      for (const activity of activityInputsForChangedFiles(pipeline, changedFiles, workspace)) activityStore.append(activity);
      await postStateUpdated(`filesystem-refresh-${refresh.reason}`, true);
      return;
    }
    pipeline = refresh.pipeline;
    for (const activity of activityInputsForChangedFiles(pipeline, changedFiles, workspace)) activityStore.append(activity);
    log(`reloaded ${pipeline.nodes.length} nodes and ${pipeline.edges.length} edges after ${refresh.attempts} scan attempt${refresh.attempts === 1 ? '' : 's'}`);
    await postStateUpdated('filesystem-refresh', true);
  }, log, selfWrites);
  panel.onDidDispose(() => {
    log('pipeline panel disposed');
    disposed = true;
    for (const timer of startupTimers) clearTimeout(timer);
    startupTimers.clear();
    configurationListener.dispose();
    viewStateListener.dispose();
    activitySubscription.dispose();
    fileWatchers.dispose();
    latestPanelSnapshot = { ...latestPanelSnapshot, open: false, lastReason: 'disposed', updatedAt: new Date().toISOString() };
    output.dispose();
  });
  panel.webview.onDidReceiveMessage(async (message) => {
    try {
      if (message?.command === 'webviewRenderStatus') {
        updateWebviewRenderSnapshot(message, stateVersion);
        log(`webview render status: ${message.renderedNodeCount ?? 0}/${message.nodeCount ?? 0} rendered, ${message.visibleNodeCount ?? 0} visible (${message.reason ?? 'unknown'})`);
        return;
      }
      if (message?.command === 'webviewReady') {
        const bootId = typeof message.bootId === 'string' ? message.bootId : undefined;
        if (bootId && bootId === lastWebviewReadyBootId) return;
        lastWebviewReadyBootId = bootId;
        latestPanelSnapshot = {
          ...latestPanelSnapshot,
          webviewReadyCount: (latestPanelSnapshot.webviewReadyCount ?? 0) + 1,
          webviewReadyBootId: bootId,
          updatedAt: new Date().toISOString()
        };
        log(`webview ready${bootId ? ` (${bootId})` : ''}; posting current state with ${pipeline.nodes.length} nodes`);
        await postStateUpdated('webview-ready', true);
        return;
      }
      if (message?.command === 'webviewRuntimeError') {
        updateWebviewRuntimeErrorSnapshot(message);
        log(`webview runtime error: ${String(message.message ?? 'unknown')}${message.detail ? ` (${String(message.detail)})` : ''}`);
        return;
      }
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
        updatePanelSnapshot(pipeline, selectedId, 'persisted-webview', stateVersion);
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
            pipeline = nextPipeline;
            const version = markStateForPost('saved-view-state');
            panel.webview.postMessage({ command: 'stateUpdated', state: await buildState(workspace, nextPipeline, activityStore, version), selectedId });
          },
          showSavedMessage: async () => {
            vscode.window.showInformationMessage('Agent Flow changes are saved to Markdown files.');
          }
        });
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
            pipeline = nextPipeline;
            const version = markStateForPost('wrote-markdown-files');
            panel.webview.postMessage({ command: 'stateUpdated', state: await buildState(workspace, nextPipeline, activityStore, version), selectedId });
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
      }
      if (message?.command === 'clearActivity') {
        log('clearing activity stream');
        activityStore.clear();
      }
      if (message?.command === 'openWorkspaceFile' && typeof message.path === 'string') {
        const target = path.resolve(workspace, message.path);
        const relative = path.relative(workspace, target);
        if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
          await vscode.window.showTextDocument(doc, { preview: true });
        }
      }
    } catch (error) {
      log(`error while handling ${String(message?.command ?? 'unknown')} message: ${(error as Error).stack ?? (error as Error).message}`);
      vscode.window.showErrorMessage(`Agent Flow failed to update files: ${(error as Error).message}`);
    }
  });
}

function updatePanelSnapshot(pipeline: AgentPipeline, selectedId: string | undefined, reason: string, stateVersion: number): void {
  latestPanelSnapshot = {
    open: true,
    nodeIds: pipeline.nodes.map((node) => node.id),
    nodeCount: pipeline.nodes.length,
    edgeCount: pipeline.edges.length,
    stateVersion,
    selectedId,
    lastReason: reason,
    updatedAt: new Date().toISOString()
  };
}

function updateWebviewRenderSnapshot(message: Record<string, unknown>, currentStateVersion: number): void {
  if (message.stateVersion !== currentStateVersion) return;
  latestPanelSnapshot = {
    ...latestPanelSnapshot,
    webviewStateVersion: typeof message.stateVersion === 'number' ? message.stateVersion : latestPanelSnapshot.webviewStateVersion,
    webviewNodeIds: Array.isArray(message.nodeIds) && message.nodeIds.every((nodeId) => typeof nodeId === 'string') ? message.nodeIds : latestPanelSnapshot.webviewNodeIds,
    webviewRenderedNodeIds: Array.isArray(message.renderedNodeIds) && message.renderedNodeIds.every((nodeId) => typeof nodeId === 'string') ? message.renderedNodeIds : latestPanelSnapshot.webviewRenderedNodeIds,
    webviewNodeCount: typeof message.nodeCount === 'number' ? message.nodeCount : latestPanelSnapshot.webviewNodeCount,
    webviewEdgeCount: typeof message.edgeCount === 'number' ? message.edgeCount : latestPanelSnapshot.webviewEdgeCount,
    webviewRenderedNodeCount: typeof message.renderedNodeCount === 'number' ? message.renderedNodeCount : latestPanelSnapshot.webviewRenderedNodeCount,
    webviewVisibleNodeCount: typeof message.visibleNodeCount === 'number' ? message.visibleNodeCount : latestPanelSnapshot.webviewVisibleNodeCount,
    webviewCanvasWidth: typeof message.canvasWidth === 'number' ? message.canvasWidth : latestPanelSnapshot.webviewCanvasWidth,
    webviewCanvasHeight: typeof message.canvasHeight === 'number' ? message.canvasHeight : latestPanelSnapshot.webviewCanvasHeight,
    webviewWindowInnerHeight: typeof message.windowInnerHeight === 'number' ? message.windowInnerHeight : latestPanelSnapshot.webviewWindowInnerHeight,
    webviewVisualViewportHeight: typeof message.visualViewportHeight === 'number' ? message.visualViewportHeight : latestPanelSnapshot.webviewVisualViewportHeight,
    webviewRootHeight: typeof message.rootHeight === 'number' ? message.rootHeight : latestPanelSnapshot.webviewRootHeight,
    webviewAppHeight: typeof message.appHeight === 'number' ? message.appHeight : latestPanelSnapshot.webviewAppHeight,
    webviewGraphTransform: typeof message.graphTransform === 'string' ? message.graphTransform : latestPanelSnapshot.webviewGraphTransform,
    webviewGraphBounds: typeof message.graphBounds === 'string' ? message.graphBounds : latestPanelSnapshot.webviewGraphBounds,
    webviewRenderReason: typeof message.reason === 'string' ? message.reason : latestPanelSnapshot.webviewRenderReason,
    updatedAt: new Date().toISOString()
  };
}

function updateWebviewRuntimeErrorSnapshot(message: Record<string, unknown>): void {
  latestPanelSnapshot = {
    ...latestPanelSnapshot,
    webviewRuntimeError: typeof message.message === 'string' ? message.message : 'Unknown Agent Flow webview runtime error.',
    webviewRuntimeErrorDetail: typeof message.detail === 'string' ? message.detail : undefined,
    updatedAt: new Date().toISOString()
  };
}


function createPipelineFileWatchers(workspace: string, onRefresh: (changedFiles: string[]) => Promise<void>, log?: AgentFlowLog, selfWrites?: FileWatchSuppression): vscode.Disposable {
  if (!activitySourceEnabled('filesystem')) {
    log?.('filesystem activity source disabled; not creating pipeline file watchers');
    return new vscode.Disposable(() => {});
  }
  const watchers = pipelineWatchPatterns.map((pattern) => vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspace, pattern)));
  log?.(`watching ${pipelineWatchPatterns.join(', ')}`);
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
    }, 180);
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

async function buildState(workspace: string, pipeline: AgentPipeline, activityStore: ActivityStore, stateVersion: number): Promise<unknown> {
  const toolOptions = buildToolOptionGroups(vscode.lm.tools);
  const displayPipeline = normalizePipelineToolsForOptions(pipeline, toolOptions);
  const findings = validatePipeline(displayPipeline);
  const risk = calculateRiskScore(displayPipeline, { copilotInstructionsLines: await countCopilotInstructionLines(workspace) });
  const activitySources = [
    ...buildActivitySourceStatuses({
    filesystem: {
      enabled: activitySourceEnabled('filesystem'),
      watchingPatterns: activitySourceEnabled('filesystem') ? pipelineWatchPatterns : []
    },
    documents: { enabled: activitySourceEnabled('vscodeDocuments') },
    tools: {
      enabled: activitySourceEnabled('agentFlowTools'),
      registered: Boolean(vscode.lm?.registerTool)
    },
    copilotDebugLogs: await getCopilotDebugLogStatus(),
    codexRollouts: await getCodexRolloutStatus(workspace),
    claudeCodeHooks: await getClaudeCodeHookStatus()
    }),
    ...localIntegrationSourceStatuses()
  ];
  const activityEvents = resolveActivityEventsForPipeline(displayPipeline, activityStore.getEvents());
  return {
    stateVersion,
    pipeline: displayPipeline,
    findings,
    risk,
    generatedFiles: generateFiles(displayPipeline).map((file) => ({ path: file.path, kind: file.kind })),
    flowLayout: coerceFlowLayout(vscode.workspace.getConfiguration('agentflow.flow').get('layout')),
    toolOptions,
    activityEvents,
    nodeRuntime: deriveNodeRuntimeState(displayPipeline, activityEvents),
    activitySources,
    debugOverlay: vscode.workspace.getConfiguration('agentflow.debug').get<boolean>('overlay', false)
  };
}

function activitySourceEnabled(key: 'filesystem' | 'vscodeDocuments' | 'agentFlowTools'): boolean {
  return vscode.workspace.getConfiguration('agentflow.activity.sources').get<boolean>(key) ?? true;
}

function localIntegrationSourceStatuses(): ActivitySourceRuntimeState[] {
  const apiEnabled = vscode.workspace.getConfiguration('agentflow.localApi').get<boolean>('enabled') ?? false;
  const apiPort = vscode.workspace.getConfiguration('agentflow.localApi').get<number>('port') ?? 0;
  const webhookEnabled = vscode.workspace.getConfiguration('agentflow.webhooks').get<boolean>('enabled') ?? false;
  const webhookUrl = vscode.workspace.getConfiguration('agentflow.webhooks').get<string>('url')?.trim();
  return [
    {
      id: 'localApi',
      label: 'Local read-only API',
      state: apiEnabled ? 'watching' : 'disabled',
      detail: apiEnabled ? `Serving redacted local payloads on 127.0.0.1:${apiPort || '<auto>'}.` : 'Local API is disabled. Enable agentflow.localApi.enabled to expose read-only local endpoints.',
      canReportReads: false,
      canReportWrites: false
    },
    {
      id: 'webhooks',
      label: 'Activity webhooks',
      state: webhookEnabled && webhookUrl ? 'watching' : webhookEnabled ? 'degraded' : 'disabled',
      detail: webhookEnabled && webhookUrl ? 'Posting redacted activity summaries to the configured webhook URL.' : webhookEnabled ? 'Webhook delivery is enabled but no URL is configured.' : 'Activity webhooks are disabled.',
      canReportReads: false,
      canReportWrites: false
    }
  ];
}

function html(webview: vscode.Webview, context: vscode.ExtensionContext, state: unknown): string {
  const script = webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'webview-dist/assets/main.js')));
  const css = webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'webview-dist/assets/main.css')));
  const nonce = String(Date.now());
  const stateJson = JSON.stringify(state).replace(/</g, '\\u003c');
  const scriptUriJson = JSON.stringify(String(script)).replace(/</g, '\\u003c');
  const nonceJson = JSON.stringify(nonce);
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
<div id="root"><div class="agentflow-boot-fallback" style="box-sizing:border-box;width:100%;height:100vh;display:grid;place-items:center;padding:24px;color:var(--vscode-foreground);background:var(--vscode-editor-background);font-family:var(--vscode-font-family,system-ui);"><div><strong>Loading Agent Flow...</strong><p style="color:var(--vscode-descriptionForeground);">Preparing the pipeline webview.</p></div></div></div>
<script nonce="${nonce}">
window.__AGENTFLOW_STATE__ = ${stateJson};
(function () {
  const root = document.getElementById('root');
  const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
  window.__AGENTFLOW_VSCODE_API__ = vscodeApi;
  function showFailure(message, detail) {
    if (!window.__AGENTFLOW_APP_BOOTED__ && root) {
      root.innerHTML = '<div style="box-sizing:border-box;width:100%;height:100vh;display:grid;place-items:center;padding:24px;color:var(--vscode-foreground);background:var(--vscode-editor-background);font-family:var(--vscode-font-family,system-ui);"><div style="max-width:560px;border:1px solid var(--vscode-editorWidget-border);background:var(--vscode-editorWidget-background);padding:16px;"><strong>' + escapeHtml(message) + '</strong><p style="color:var(--vscode-descriptionForeground);line-height:1.45;">' + escapeHtml(detail || 'Open the Agent Flow output channel for details.') + '</p></div></div>';
    }
    vscodeApi?.postMessage({ command: 'webviewRuntimeError', message, detail });
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
    });
  }
  window.addEventListener('error', function (event) {
    if (/ResizeObserver loop/.test(event.message || '')) return;
    showFailure('Agent Flow webview failed to load', event.message || 'A webview script error occurred.');
  });
  window.addEventListener('unhandledrejection', function (event) {
    showFailure('Agent Flow webview failed to load', event.reason?.message || String(event.reason || 'Unhandled webview promise rejection.'));
  });
  const script = document.createElement('script');
  script.nonce = ${nonceJson};
  script.src = ${scriptUriJson};
  script.onerror = function () {
    showFailure('Agent Flow webview failed to load', 'The compiled webview bundle could not be loaded. Run npm run build, then restart VS Code with --extensionDevelopmentPath.');
  };
  document.body.appendChild(script);
})();
</script>
</body>
</html>`;
}
