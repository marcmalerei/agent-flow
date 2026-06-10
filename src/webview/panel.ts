import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { countCopilotInstructionLines, loadOrInferPipeline } from '../pipeline/scanner';
import { parsePipeline } from '../pipeline/parser';
import { normalizePipelineAgentReferences } from '../pipeline/referenceResolver';
import { validatePipeline } from '../pipeline/validator';
import { calculateRiskScore } from '../pipeline/riskScore';
import { generateFiles, generateMermaid } from '../pipeline/generators';
import { AgentPipeline } from '../pipeline/types';

export async function openPipelinePanel(context: vscode.ExtensionContext): Promise<void> {
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspace) { vscode.window.showErrorMessage('Open a workspace folder before opening AgentFlow.'); return; }
  let pipeline = await loadOrInferPipeline(workspace);
  const panel = vscode.window.createWebviewPanel('agentflow.pipeline', 'AgentFlow Pipeline', vscode.ViewColumn.One, {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'webview-dist'))]
  });
  panel.webview.html = html(panel.webview, context, await buildState(workspace, pipeline));
  panel.webview.onDidReceiveMessage(async (message) => {
    if (message?.command === 'savePipeline') {
      pipeline = normalizePipelineAgentReferences(parsePipeline(message.pipeline));
      await writePipeline(workspace, pipeline);
      await writeGeneratedFiles(workspace, pipeline);
      panel.webview.postMessage({ command: 'stateUpdated', state: await buildState(workspace, pipeline), selectedId: message.selectedId });
      vscode.window.showInformationMessage('AgentFlow pipeline saved to JSON and Markdown files.');
    }
  });
}

async function buildState(workspace: string, pipeline: AgentPipeline): Promise<unknown> {
  const findings = validatePipeline(pipeline);
  const risk = calculateRiskScore(pipeline, { copilotInstructionsLines: await countCopilotInstructionLines(workspace) });
  return { pipeline, findings, risk, mermaid: generateMermaid(pipeline), generatedFiles: generateFiles(pipeline).map((file) => ({ path: file.path, kind: file.kind })) };
}

async function writePipeline(workspace: string, pipeline: AgentPipeline): Promise<void> {
  const target = path.join(workspace, '.agent-pipeline/pipeline.json');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(pipeline, null, 2)}\n`, 'utf8');
}

async function writeGeneratedFiles(workspace: string, pipeline: AgentPipeline): Promise<void> {
  for (const file of generateFiles(pipeline)) {
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
