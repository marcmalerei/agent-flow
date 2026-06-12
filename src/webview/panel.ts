import * as vscode from 'vscode';
import * as path from 'node:path';
import { countCopilotInstructionLines, loadOrInferPipeline } from '../pipeline/scanner';
import { validatePipeline } from '../pipeline/validator';
import { calculateRiskScore } from '../pipeline/riskScore';
import { generateFiles } from '../pipeline/generators';
import { AgentPipeline } from '../pipeline/types';
import { listToolOptionNames } from './toolOptions';
import { handlePersistPipelineMessage, handleSavePipelineMessage, handleWriteMarkdownFilesMessage } from './panelMessages';
import { coerceFlowLayout } from './flowLayout';
import { AgentFlowLog, writeGeneratedFiles } from './filePersistence';
import { FileWatchSuppression } from './fileWatchSuppression';

export async function openPipelinePanel(context: vscode.ExtensionContext): Promise<void> {
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspace) { vscode.window.showErrorMessage('Open a workspace folder before opening Agent Flow.'); return; }
  const output = vscode.window.createOutputChannel('Agent Flow');
  const log: AgentFlowLog = (message) => output.appendLine(`[${new Date().toISOString()}] ${message}`);
  const selfWrites = new FileWatchSuppression();
  log(`opening pipeline panel for ${workspace}`);
  let pipeline = await loadOrInferPipeline(workspace);
  let selectedId: string | undefined;
  const panel: vscode.WebviewPanel = vscode.window.createWebviewPanel('agentflow.pipeline', 'Agent Flow Pipeline', vscode.ViewColumn.One, {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'webview-dist'))]
  });
  panel.webview.html = html(panel.webview, context, await buildState(workspace, pipeline));
  const configurationListener = vscode.workspace.onDidChangeConfiguration(async (event) => {
    if (!event.affectsConfiguration('agentflow.flow.layout')) return;
    log('flow layout configuration changed');
    panel.webview.postMessage({ command: 'stateUpdated', state: await buildState(workspace, pipeline), selectedId });
  });
  const fileWatchers = createPipelineFileWatchers(workspace, async () => {
    log('filesystem change detected; reloading pipeline');
    pipeline = await loadOrInferPipeline(workspace);
    log(`reloaded ${pipeline.nodes.length} nodes and ${pipeline.edges.length} edges`);
    panel.webview.postMessage({ command: 'stateUpdated', state: await buildState(workspace, pipeline), selectedId });
  }, log, selfWrites);
  panel.onDidDispose(() => {
    log('pipeline panel disposed');
    configurationListener.dispose();
    fileWatchers.dispose();
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
            panel.webview.postMessage({ command: 'stateUpdated', state: await buildState(workspace, nextPipeline), selectedId });
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
            panel.webview.postMessage({ command: 'stateUpdated', state: await buildState(workspace, nextPipeline), selectedId });
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
    } catch (error) {
      log(`error while handling ${String(message?.command ?? 'unknown')} message: ${(error as Error).stack ?? (error as Error).message}`);
      vscode.window.showErrorMessage(`Agent Flow failed to update files: ${(error as Error).message}`);
    }
  });
}


function createPipelineFileWatchers(workspace: string, onRefresh: () => Promise<void>, log?: AgentFlowLog, selfWrites?: FileWatchSuppression): vscode.Disposable {
  const patterns = [
    '.agent-pipeline/pipeline.json',
    '.github/agents/**/*.agent.md',
    '.github/prompts/**/*.prompt.md',
    '.github/instructions/**/*.instructions.md',
    '.github/skills/**/SKILL.md',
    '.github/roles/**/*.md',
    '.agent-output/**/*.{md,json,txt}'
  ];
  const watchers = patterns.map((pattern) => vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspace, pattern)));
  log?.(`watching ${patterns.join(', ')}`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const schedule = (uri: vscode.Uri) => {
    if (disposed) return;
    if (selfWrites?.consumeIfSelfWrite(uri.fsPath)) {
      log?.(`ignored self-triggered filesystem event for ${path.relative(workspace, uri.fsPath).replace(/\\/g, '/')}`);
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      onRefresh().catch((error) => {
        log?.(`filesystem refresh failed: ${(error as Error).stack ?? (error as Error).message}`);
        vscode.window.showWarningMessage(`Agent Flow could not refresh the pipeline after file changes: ${(error as Error).message}`);
      });
    }, 250);
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

async function buildState(workspace: string, pipeline: AgentPipeline): Promise<unknown> {
  const findings = validatePipeline(pipeline);
  const risk = calculateRiskScore(pipeline, { copilotInstructionsLines: await countCopilotInstructionLines(workspace) });
  return {
    pipeline,
    findings,
    risk,
    generatedFiles: generateFiles(pipeline).map((file) => ({ path: file.path, kind: file.kind })),
    flowLayout: coerceFlowLayout(vscode.workspace.getConfiguration('agentflow.flow').get('layout')),
    toolOptions: listToolOptionNames(vscode.lm.tools)
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
