import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createDefaultPipeline } from './pipeline/defaultPipeline';
import { stringifyPipeline } from './pipeline/parser';
import { countCopilotInstructionLines, loadOrInferPipeline } from './pipeline/scanner';
import { validatePipeline } from './pipeline/validator';
import { calculateRiskScore } from './pipeline/riskScore';
import { generateFiles, generateMermaid } from './pipeline/generators';
import { AgentPipeline, GeneratedFile } from './pipeline/types';
import { openPipelinePanel } from './webview/panel';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('agentflow.openPipeline', () => openPipelinePanel(context)),
    vscode.commands.registerCommand('agentflow.scanWorkspace', scanWorkspaceCommand),
    vscode.commands.registerCommand('agentflow.generateFiles', generateFilesCommand),
    vscode.commands.registerCommand('agentflow.validatePipeline', validatePipelineCommand),
    vscode.commands.registerCommand('agentflow.exportMermaid', exportMermaidCommand),
    vscode.commands.registerCommand('agentflow.createDefaultPipeline', createDefaultPipelineCommand)
  );
}

export function deactivate(): void {}

export function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function loadWorkspacePipeline(): Promise<{ workspace: string; pipeline: AgentPipeline }> {
  const workspace = getWorkspaceRoot();
  if (!workspace) throw new Error('Open a workspace folder before using AgentFlow.');
  return { workspace, pipeline: await loadOrInferPipeline(workspace) };
}

async function scanWorkspaceCommand(): Promise<void> {
  const { pipeline } = await loadWorkspacePipeline();
  vscode.window.showInformationMessage(`AgentFlow found ${pipeline.nodes.length} nodes and ${pipeline.edges.length} edges.`);
}

async function createDefaultPipelineCommand(): Promise<void> {
  const workspace = getWorkspaceRoot();
  if (!workspace) { vscode.window.showErrorMessage('Open a workspace folder before creating a pipeline.'); return; }
  const target = path.join(workspace, '.agent-pipeline/pipeline.json');
  const pipeline = createDefaultPipeline();
  if (await fileExists(target)) {
    const answer = await vscode.window.showWarningMessage('pipeline.json already exists. Overwrite it with the AgentFlow default preset?', { modal: true }, 'Overwrite');
    if (answer !== 'Overwrite') return;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, stringifyPipeline(pipeline), 'utf8');
  vscode.window.showInformationMessage('AgentFlow default pipeline created.');
}

async function validatePipelineCommand(): Promise<void> {
  const { workspace, pipeline } = await loadWorkspacePipeline();
  const findings = validatePipeline(pipeline);
  const risk = calculateRiskScore(pipeline, { copilotInstructionsLines: await countCopilotInstructionLines(workspace) });
  const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: renderValidationReport(pipeline.name, findings, risk) });
  await vscode.window.showTextDocument(doc, { preview: true });
}

async function exportMermaidCommand(): Promise<void> {
  const { pipeline } = await loadWorkspacePipeline();
  const mermaid = generateMermaid(pipeline);
  await vscode.env.clipboard.writeText(mermaid);
  const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: `\`\`\`mermaid\n${mermaid}\`\`\`\n` });
  await vscode.window.showTextDocument(doc, { preview: true });
  vscode.window.showInformationMessage('AgentFlow Mermaid diagram copied to clipboard.');
}

async function generateFilesCommand(): Promise<void> {
  const { workspace, pipeline } = await loadWorkspacePipeline();
  const files = generateFiles(pipeline);
  const preview = await previewGeneratedFiles(workspace, files);
  const doc = await vscode.workspace.openTextDocument({ language: 'diff', content: preview });
  await vscode.window.showTextDocument(doc, { preview: true });
  const answer = await vscode.window.showWarningMessage(`Write ${files.length} generated AgentFlow files? Existing generated or user files may be overwritten only after this confirmation.`, { modal: true }, 'Write Files');
  if (answer !== 'Write Files') return;
  for (const file of files) {
    const target = path.join(workspace, file.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content, 'utf8');
  }
  vscode.window.showInformationMessage(`AgentFlow wrote ${files.length} files.`);
}

async function previewGeneratedFiles(workspace: string, files: GeneratedFile[]): Promise<string> {
  const sections: string[] = [];
  for (const file of files) {
    const target = path.join(workspace, file.path);
    const current = await readFileOrEmpty(target);
    sections.push(`--- ${file.path}\n+++ ${file.path}\n@@ AgentFlow generated preview @@\n${current ? summarize(current, '-') : '- <new file>\n'}${summarize(file.content, '+')}`);
  }
  return sections.join('\n');
}

function summarize(content: string, prefix: string): string {
  return content.split(/\r?\n/).slice(0, 80).map((line) => `${prefix}${line}`).join('\n') + '\n';
}

async function readFileOrEmpty(file: string): Promise<string> {
  try { return await fs.readFile(file, 'utf8'); } catch { return ''; }
}

async function fileExists(file: string): Promise<boolean> {
  try { await fs.access(file); return true; } catch { return false; }
}

function renderValidationReport(name: string, findings: ReturnType<typeof validatePipeline>, risk: ReturnType<typeof calculateRiskScore>): string {
  return `# AgentFlow Validation: ${name}\n\n## Findings\n\n${findings.length ? findings.map((item) => `- **${item.severity.toUpperCase()}** (${item.ruleId}) ${item.message}`).join('\n') : 'No findings.'}\n\n## Context Risk Score\n\n${risk.score}/100\n\n${risk.reasons.map((reason) => `- ${reason}`).join('\n') || 'No risk reasons.'}\n`;
}
