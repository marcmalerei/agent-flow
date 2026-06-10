import * as vscode from 'vscode';
import * as path from 'node:path';
import { countCopilotInstructionLines, loadOrInferPipeline } from '../pipeline/scanner';
import { validatePipeline } from '../pipeline/validator';
import { calculateRiskScore } from '../pipeline/riskScore';
import { generateFiles, generateMermaid } from '../pipeline/generators';

export async function openPipelinePanel(context: vscode.ExtensionContext): Promise<void> {
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspace) { vscode.window.showErrorMessage('Open a workspace folder before opening AgentFlow.'); return; }
  const pipeline = await loadOrInferPipeline(workspace);
  const findings = validatePipeline(pipeline);
  const risk = calculateRiskScore(pipeline, { copilotInstructionsLines: await countCopilotInstructionLines(workspace) });
  const generatedFiles = generateFiles(pipeline).map((file) => ({ path: file.path, kind: file.kind }));
  const panel = vscode.window.createWebviewPanel('agentflow.pipeline', 'AgentFlow Pipeline', vscode.ViewColumn.One, {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'webview-dist'))]
  });
  panel.webview.html = html(panel.webview, context, { pipeline, findings, risk, mermaid: generateMermaid(pipeline), generatedFiles });
  panel.webview.onDidReceiveMessage(async (message) => {
    if (message?.command === 'exportMermaid') {
      await vscode.env.clipboard.writeText(generateMermaid(pipeline));
      vscode.window.showInformationMessage('AgentFlow Mermaid diagram copied to clipboard.');
    }
    if (message?.command === 'generateFiles') {
      await vscode.commands.executeCommand('agentflow.generateFiles');
    }
  });
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
