import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { countCopilotInstructionLines, loadOrInferPipeline } from '../pipeline/scanner';
import { validatePipeline } from '../pipeline/validator';
import { calculateRiskScore } from '../pipeline/riskScore';
import { generateFiles } from '../pipeline/generators';
import { AgentPipeline } from '../pipeline/types';
import { listToolOptionNames } from './toolOptions';
import { handleSavePipelineMessage, handleWriteMarkdownFilesMessage } from './panelMessages';
import { coerceFlowLayout } from './flowLayout';

export async function openPipelinePanel(context: vscode.ExtensionContext): Promise<void> {
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspace) { vscode.window.showErrorMessage('Open a workspace folder before opening AgentFlow.'); return; }
  let pipeline = await loadOrInferPipeline(workspace);
  let selectedId: string | undefined;
  const panel: vscode.WebviewPanel = vscode.window.createWebviewPanel('agentflow.pipeline', 'AgentFlow Pipeline', vscode.ViewColumn.One, {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'webview-dist'))]
  });
  panel.webview.html = html(panel.webview, context, await buildState(workspace, pipeline));
  const configurationListener = vscode.workspace.onDidChangeConfiguration(async (event) => {
    if (!event.affectsConfiguration('agentflow.flow.layout')) return;
    panel.webview.postMessage({ command: 'stateUpdated', state: await buildState(workspace, pipeline), selectedId });
  });
  const fileWatchers = createPipelineFileWatchers(workspace, async () => {
    pipeline = await loadOrInferPipeline(workspace);
    panel.webview.postMessage({ command: 'stateUpdated', state: await buildState(workspace, pipeline), selectedId });
  });
  panel.onDidDispose(() => {
    configurationListener.dispose();
    fileWatchers.dispose();
  });
  panel.webview.onDidReceiveMessage(async (message) => {
    if (message?.command === 'savePipeline') {
      selectedId = typeof message.selectedId === 'string' ? message.selectedId : selectedId;
      pipeline = await handleSavePipelineMessage({
        message,
        workspace,
        writePipeline,
        postState: async (nextPipeline, selectedId) => {
          panel.webview.postMessage({ command: 'stateUpdated', state: await buildState(workspace, nextPipeline), selectedId });
        },
        showSavedMessage: async () => {
          vscode.window.showInformationMessage('AgentFlow pipeline saved to JSON.');
        }
      });
    }
    if (message?.command === 'writeMarkdownFiles') {
      selectedId = typeof message.selectedId === 'string' ? message.selectedId : selectedId;
      const nextPipeline = await handleWriteMarkdownFilesMessage({
        message,
        workspace,
        writeMarkdownFiles: writeGeneratedFiles,
        postState: async (nextPipeline, selectedId) => {
          panel.webview.postMessage({ command: 'stateUpdated', state: await buildState(workspace, nextPipeline), selectedId });
        },
        confirmWrite: async (fileCount) => {
          const answer = await vscode.window.showWarningMessage(`Write ${fileCount} generated AgentFlow Markdown/artifact files? Existing files may be overwritten.`, { modal: true }, 'Write Files');
          return answer === 'Write Files';
        },
        showWrittenMessage: async (fileCount) => {
          vscode.window.showInformationMessage(`AgentFlow wrote ${fileCount} generated files.`);
        }
      });
      if (nextPipeline) pipeline = nextPipeline;
    }
  });
}


function createPipelineFileWatchers(workspace: string, onRefresh: () => Promise<void>): vscode.Disposable {
  const patterns = [
    '.agent-pipeline/pipeline.json',
    '.github/agents/**/*.agent.md',
    '.github/prompts/**/*.prompt.md',
    '.github/instructions/**/*.instructions.md',
    '.github/skills/**/SKILL.md',
    '.agent-output/**/*.{md,json,txt}'
  ];
  const watchers = patterns.map((pattern) => vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspace, pattern)));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const schedule = () => {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      onRefresh().catch((error) => vscode.window.showWarningMessage(`AgentFlow could not refresh the pipeline after file changes: ${(error as Error).message}`));
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

async function writePipeline(workspace: string, pipeline: AgentPipeline): Promise<void> {
  const target = path.join(workspace, '.agent-pipeline/pipeline.json');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(pipeline, null, 2)}\n`, 'utf8');
}

async function writeGeneratedFiles(workspace: string, pipeline: AgentPipeline): Promise<void> {
  for (const file of generateFiles(pipeline).filter((file) => file.kind !== 'pipeline')) {
    const target = path.join(workspace, file.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content, 'utf8');
  }
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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${css}">
<title>AgentFlow</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}">window.__AGENTFLOW_STATE__ = ${JSON.stringify(state).replace(/</g, '\\u003c')};</script>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}
