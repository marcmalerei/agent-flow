import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createDefaultPipeline } from './pipeline/defaultPipeline';
import { countCopilotInstructionLines, loadOrInferPipeline } from './pipeline/scanner';
import { validatePipeline } from './pipeline/validator';
import { calculateRiskScore } from './pipeline/riskScore';
import { generateFiles } from './pipeline/generators';
import { AgentPipeline, GeneratedFile } from './pipeline/types';
import { getLatestPipelinePanelSnapshot, openPipelinePanel } from './webview/panel';
import { ActivityStore } from './activity/store';
import { completeNodeActivity, reportActivity, selectActivityNode } from './activity/tools';
import { getCopilotDebugLogStatus, startCopilotDebugLogAdapter } from './activity/copilotDebugLogAdapter';
import { getCodexRolloutStatus, startCodexRolloutAdapter } from './activity/codexRolloutAdapter';
import { activityInputForPipelineDocumentPath } from './activity/fileActivity';
import { createSyntheticActivity } from './activity/synthetic';
import { renderActivityCsv, renderAgentFlowReport } from './activity/exportReport';
import { createActivityReplayPlan, parseActivityLogJsonl } from './activity/importLog';
import { buildActivitySourceStatuses } from './activity/sources';
import { buildSetupValidationReport, renderSetupValidationReport } from './setup/setupValidator';
import { buildToolOptionGroups, listToolOptionNames, normalizePipelineToolsForOptions } from './webview/toolOptions';

const activityStore = new ActivityStore();
const MINIMUM_VSCODE_VERSION = '1.120.0';
const PIPELINE_WATCH_PATTERNS = ['.github/agents/*.agent.md', '.github/prompts/*.prompt.md', '.github/instructions/*.instructions.md', '.github/skills/**/SKILL.md', '.github/roles/*.md', '.github/artifacts/**/*.{md,json,txt}'];
let activeReplay: { events: ReturnType<typeof createActivityReplayPlan>[number]['event'][]; speed: number; timers: ReturnType<typeof setTimeout>[] } | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const activityOutput = vscode.window.createOutputChannel('Agent Flow Activity');
  context.subscriptions.push(activityOutput, startCopilotDebugLogAdapter(activityStore, (message) => activityOutput.appendLine(`[${new Date().toISOString()}] ${message}`)));
  context.subscriptions.push(startCodexRolloutAdapter(activityStore, {
    workspaceProvider: getWorkspaceRoot,
    pipelineProvider: async () => {
      const workspace = getWorkspaceRoot();
      return workspace ? loadOrInferPipeline(workspace) : undefined;
    }
  }, (message) => activityOutput.appendLine(`[${new Date().toISOString()}] ${message}`)));
  context.subscriptions.push(registerPipelineDocumentActivity(activityStore));
  context.subscriptions.push(...registerActivityTools());
  context.subscriptions.push(
    vscode.commands.registerCommand('agentflow.openPipeline', () => openPipelinePanel(context, activityStore)),
    vscode.commands.registerCommand('agentflow.scanWorkspace', scanWorkspaceCommand),
    vscode.commands.registerCommand('agentflow.generateFiles', generateFilesCommand),
    vscode.commands.registerCommand('agentflow.validatePipeline', validatePipelineCommand),
    vscode.commands.registerCommand('agentflow.createDefaultPipeline', createDefaultPipelineCommand),
    vscode.commands.registerCommand('agentflow.playDemoActivity', playDemoActivityCommand),
    vscode.commands.registerCommand('agentflow.exportReport', exportReportCommand),
    vscode.commands.registerCommand('agentflow.exportActivityCsv', exportActivityCsvCommand),
    vscode.commands.registerCommand('agentflow.checkSetup', checkSetupCommand),
    vscode.commands.registerCommand('agentflow.importActivityLog', importActivityLogCommand),
    vscode.commands.registerCommand('agentflow.pauseActivityReplay', pauseActivityReplayCommand),
    vscode.commands.registerCommand('agentflow.restartActivityReplay', restartActivityReplayCommand),
    vscode.commands.registerCommand('agentflow.copyDebugSnapshot', copyDebugSnapshotCommand),
    vscode.commands.registerCommand('agentflow.toggleDebugOverlay', toggleDebugOverlayCommand),
    vscode.commands.registerCommand('agentflow.debugSnapshot', () => getLatestPipelinePanelSnapshot())
  );
}

async function copyDebugSnapshotCommand(): Promise<void> {
  await vscode.env.clipboard.writeText(JSON.stringify(getLatestPipelinePanelSnapshot(), null, 2));
  vscode.window.showInformationMessage('Agent Flow debug snapshot copied to clipboard.');
}

async function toggleDebugOverlayCommand(): Promise<void> {
  const config = vscode.workspace.getConfiguration('agentflow.debug');
  const next = !config.get<boolean>('overlay', false);
  await config.update('overlay', next, vscode.ConfigurationTarget.Workspace);
  vscode.window.showInformationMessage(`Agent Flow debug overlay ${next ? 'enabled' : 'disabled'}.`);
}

function registerPipelineDocumentActivity(store: ActivityStore): vscode.Disposable {
  const append = (document: vscode.TextDocument, action: 'read' | 'write') => {
    if (!(vscode.workspace.getConfiguration('agentflow.activity.sources').get<boolean>('vscodeDocuments') ?? true)) return;
    if (document.uri.scheme !== 'file') return;
    const input = activityInputForPipelineDocumentPath(document.uri.fsPath, getWorkspaceRoot(), action);
    if (input) store.append(input);
  };
  const open = vscode.workspace.onDidOpenTextDocument((document) => append(document, 'read'));
  const save = vscode.workspace.onDidSaveTextDocument((document) => append(document, 'write'));
  return new vscode.Disposable(() => {
    open.dispose();
    save.dispose();
  });
}

export function deactivate(): void {}

export function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function loadWorkspacePipeline(): Promise<{ workspace: string; pipeline: AgentPipeline }> {
  const workspace = getWorkspaceRoot();
  if (!workspace) throw new Error('Open a workspace folder before using Agent Flow.');
  return { workspace, pipeline: await loadOrInferPipeline(workspace) };
}

async function scanWorkspaceCommand(): Promise<void> {
  const { pipeline } = await loadWorkspacePipeline();
  vscode.window.showInformationMessage(`Agent Flow found ${pipeline.nodes.length} nodes and ${pipeline.edges.length} edges.`);
}

async function createDefaultPipelineCommand(): Promise<void> {
  const workspace = getWorkspaceRoot();
  if (!workspace) { vscode.window.showErrorMessage('Open a workspace folder before creating a pipeline.'); return; }
  const pipeline = createDefaultPipeline();
  const files = generateFiles(pipeline);
  if (await anyFileExists(workspace, files)) {
    const answer = await vscode.window.showWarningMessage('Agent Flow generated files already exist. Overwrite them with the default preset?', { modal: true }, 'Overwrite');
    if (answer !== 'Overwrite') return;
  }
  for (const file of files) {
    const fileTarget = path.join(workspace, file.path);
    await fs.mkdir(path.dirname(fileTarget), { recursive: true });
    await fs.writeFile(fileTarget, file.content, 'utf8');
  }
  vscode.window.showInformationMessage('Agent Flow default files created.');
}

async function validatePipelineCommand(): Promise<void> {
  const { workspace, pipeline } = await loadWorkspacePipeline();
  const findings = validatePipeline(pipeline);
  const risk = calculateRiskScore(pipeline, { copilotInstructionsLines: await countCopilotInstructionLines(workspace) });
  const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: renderValidationReport(pipeline.name, findings, risk) });
  await vscode.window.showTextDocument(doc, { preview: true });
}

async function playDemoActivityCommand(): Promise<void> {
  const { pipeline } = await loadWorkspacePipeline();
  const events = createSyntheticActivity(pipeline, `demo-${Date.now()}`);
  for (const event of events) activityStore.append(event);
  vscode.window.showInformationMessage(`Agent Flow emitted ${events.length} demo activity events.`);
}

async function exportReportCommand(): Promise<void> {
  const { workspace, pipeline } = await loadWorkspacePipeline();
  const report = renderAgentFlowReport({
    pipeline,
    findings: validatePipeline(pipeline),
    risk: calculateRiskScore(pipeline, { copilotInstructionsLines: await countCopilotInstructionLines(workspace) }),
    activityEvents: activityStore.getEvents()
  });
  const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: report });
  await vscode.window.showTextDocument(doc, { preview: true });
}

async function exportActivityCsvCommand(): Promise<void> {
  const workspace = getWorkspaceRoot();
  const target = await vscode.window.showSaveDialog({
    defaultUri: workspace ? vscode.Uri.file(path.join(workspace, 'agent-flow-activity.csv')) : undefined,
    filters: { CSV: ['csv'] },
    saveLabel: 'Export Activity CSV'
  });
  if (!target) return;
  await fs.writeFile(target.fsPath, renderActivityCsv(activityStore.getEvents()), 'utf8');
  vscode.window.showInformationMessage(`Agent Flow activity CSV exported to ${target.fsPath}.`);
}

async function checkSetupCommand(): Promise<void> {
  const workspace = getWorkspaceRoot();
  const toolGroups = buildToolOptionGroups(vscode.lm?.tools ?? []);
  const pipeline = workspace ? normalizePipelineToolsForOptions(await loadOrInferPipeline(workspace), toolGroups) : undefined;
  const activitySources = buildActivitySourceStatuses({
    filesystem: {
      enabled: activitySourceEnabled('filesystem'),
      watchingPatterns: activitySourceEnabled('filesystem') ? PIPELINE_WATCH_PATTERNS : []
    },
    documents: { enabled: activitySourceEnabled('vscodeDocuments') },
    tools: {
      enabled: activitySourceEnabled('agentFlowTools'),
      registered: Boolean(vscode.lm?.registerTool)
    },
    copilotDebugLogs: await getCopilotDebugLogStatus(),
    codexRollouts: await getCodexRolloutStatus(workspace)
  });
  const report = buildSetupValidationReport({
    vscodeVersion: vscode.version,
    minimumVscodeVersion: MINIMUM_VSCODE_VERSION,
    hasLanguageModelToolApi: Boolean(vscode.lm?.registerTool),
    workspace: workspace ? {
      root: workspace,
      existingPaths: await listExistingGithubPaths(workspace),
      pipeline
    } : undefined,
    registeredTools: listToolOptionNames(vscode.lm?.tools ?? []),
    activitySources
  });
  const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: renderSetupValidationReport(report) });
  await vscode.window.showTextDocument(doc, { preview: true });
  const actionable = report.checks.filter((check) => check.severity === 'error' || check.severity === 'warning');
  if (!actionable.length) {
    vscode.window.showInformationMessage('Agent Flow setup check passed.');
    return;
  }
  const answer = await vscode.window.showWarningMessage(`Agent Flow setup found ${report.summary.errors} error(s) and ${report.summary.warnings} warning(s).`, 'Open Settings', 'Create Default Pipeline', 'Open Docs');
  if (answer === 'Open Settings') await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:marcmalerei.copilot-agent-flow-studio agentflow');
  if (answer === 'Create Default Pipeline') await vscode.commands.executeCommand('agentflow.createDefaultPipeline');
  if (answer === 'Open Docs') await vscode.commands.executeCommand('vscode.open', vscode.Uri.parse('https://github.com/marcmalerei/agent-flow#readme'));
}

async function importActivityLogCommand(): Promise<void> {
  const workspace = getWorkspaceRoot();
  const selection = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { 'Activity JSONL': ['jsonl', 'json'] },
    openLabel: 'Import Activity Log'
  });
  const uri = selection?.[0];
  if (!uri) return;

  const pipeline = workspace ? await loadOrInferPipeline(workspace) : undefined;
  const content = await fs.readFile(uri.fsPath, 'utf8');
  const result = parseActivityLogJsonl(content, { sourceFile: uri.fsPath, pipeline });
  if (result.diagnostics.length) {
    vscode.window.showWarningMessage(`Agent Flow imported ${result.events.length} events with ${result.diagnostics.length} warning(s).`);
  }
  if (!result.events.length) {
    vscode.window.showWarningMessage('Agent Flow did not find activity events in that log.');
    return;
  }

  const mode = await vscode.window.showQuickPick(['Import now', 'Replay 1x', 'Replay 2x', 'Replay 5x'], {
    placeHolder: 'How should Agent Flow load this activity log?'
  });
  if (!mode) return;
  if (mode === 'Import now') {
    stopActivityReplay();
    for (const event of result.events) activityStore.append(event);
    vscode.window.showInformationMessage(`Agent Flow imported ${result.events.length} activity event${result.events.length === 1 ? '' : 's'}.`);
    return;
  }
  const speed = Number.parseInt(mode.replace(/\D/g, ''), 10) || 1;
  startActivityReplay(result.events, speed);
  vscode.window.showInformationMessage(`Agent Flow replaying ${result.events.length} activity event${result.events.length === 1 ? '' : 's'} at ${speed}x.`);
}

function pauseActivityReplayCommand(): void {
  if (!activeReplay) {
    vscode.window.showInformationMessage('Agent Flow has no active activity replay.');
    return;
  }
  stopActivityReplay(false);
  vscode.window.showInformationMessage('Agent Flow activity replay paused.');
}

function restartActivityReplayCommand(): void {
  if (!activeReplay?.events.length) {
    vscode.window.showInformationMessage('Agent Flow has no imported activity replay to restart.');
    return;
  }
  const { events, speed } = activeReplay;
  startActivityReplay(events, speed);
  vscode.window.showInformationMessage(`Agent Flow restarted activity replay at ${speed}x.`);
}

async function generateFilesCommand(): Promise<void> {
  const { workspace, pipeline } = await loadWorkspacePipeline();
  const files = generateFiles(pipeline);
  const preview = await previewGeneratedFiles(workspace, files);
  const doc = await vscode.workspace.openTextDocument({ language: 'diff', content: preview });
  await vscode.window.showTextDocument(doc, { preview: true });
  const answer = await vscode.window.showWarningMessage(`Write ${files.length} generated Agent Flow files? Existing generated or user files may be overwritten only after this confirmation.`, { modal: true }, 'Write Files');
  if (answer !== 'Write Files') return;
  for (const file of files) {
    const target = path.join(workspace, file.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content, 'utf8');
  }
  vscode.window.showInformationMessage(`Agent Flow wrote ${files.length} files.`);
}

async function previewGeneratedFiles(workspace: string, files: GeneratedFile[]): Promise<string> {
  const sections: string[] = [];
  for (const file of files) {
    const target = path.join(workspace, file.path);
    const current = await readFileOrEmpty(target);
    sections.push(`--- ${file.path}\n+++ ${file.path}\n@@ Agent Flow generated preview @@\n${current ? summarize(current, '-') : '- <new file>\n'}${summarize(file.content, '+')}`);
  }
  return sections.join('\n');
}

function summarize(content: string, prefix: string): string {
  return content.split(/\r?\n/).slice(0, 80).map((line) => `${prefix}${line}`).join('\n') + '\n';
}

async function readFileOrEmpty(file: string): Promise<string> {
  try { return await fs.readFile(file, 'utf8'); } catch { return ''; }
}

async function anyFileExists(workspace: string, files: GeneratedFile[]): Promise<boolean> {
  for (const file of files) {
    try { await fs.access(path.join(workspace, file.path)); return true; } catch {}
  }
  return false;
}

function renderValidationReport(name: string, findings: ReturnType<typeof validatePipeline>, risk: ReturnType<typeof calculateRiskScore>): string {
  return `# Agent Flow Validation: ${name}\n\n## Findings\n\n${findings.length ? findings.map((item) => `- **${item.severity.toUpperCase()}** (${item.ruleId}) ${item.message}`).join('\n') : 'No findings.'}\n\n## Context Risk Score\n\n${risk.score}/100\n\n${risk.reasons.map((reason) => `- ${reason}`).join('\n') || 'No risk reasons.'}\n`;
}

function activitySourceEnabled(source: 'filesystem' | 'vscodeDocuments' | 'agentFlowTools'): boolean {
  return vscode.workspace.getConfiguration('agentflow.activity.sources').get<boolean>(source) ?? true;
}

async function listExistingGithubPaths(workspace: string): Promise<string[]> {
  const root = path.join(workspace, '.github');
  const paths: string[] = [];
  async function visit(folder: string): Promise<void> {
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = await fs.readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }
    paths.push(path.relative(workspace, folder).replace(/\\/g, '/'));
    for (const entry of entries) {
      const target = path.join(folder, entry.name);
      const relative = path.relative(workspace, target).replace(/\\/g, '/');
      paths.push(relative);
      if (entry.isDirectory()) await visit(target);
    }
  }
  await visit(root);
  return [...new Set(paths)];
}

function startActivityReplay(events: ReturnType<typeof createActivityReplayPlan>[number]['event'][], speed: number): void {
  stopActivityReplay(false);
  const plan = createActivityReplayPlan(events, speed);
  const timers = plan.map((step) => setTimeout(() => activityStore.append(step.event), step.delayMs));
  activeReplay = { events, speed, timers };
}

function stopActivityReplay(clearState = true): void {
  if (!activeReplay) return;
  for (const timer of activeReplay.timers) clearTimeout(timer);
  if (clearState) activeReplay = undefined;
  else activeReplay.timers = [];
}

function registerActivityTools(): vscode.Disposable[] {
  if (!(vscode.workspace.getConfiguration('agentflow.activity.sources').get<boolean>('agentFlowTools') ?? true)) return [];
  if (!vscode.lm?.registerTool) return [];
  return [
    vscode.lm.registerTool('agentflow_select_node', {
      invoke: async (options) => {
        const { pipeline } = await loadWorkspacePipeline();
        const result = selectActivityNode(options.input as any, { pipeline, store: activityStore });
        return toolResult(result);
      }
    }),
    vscode.lm.registerTool('agentflow_report_activity', {
      invoke: async (options) => {
        const { pipeline } = await loadWorkspacePipeline();
        const result = reportActivity(options.input as any, { pipeline, store: activityStore });
        return toolResult({ eventId: result.event.id, nodeId: result.event.nodeId, phase: result.event.phase });
      }
    }),
    vscode.lm.registerTool('agentflow_complete_node', {
      invoke: async (options) => {
        const { pipeline } = await loadWorkspacePipeline();
        const result = completeNodeActivity(options.input as any, { pipeline, store: activityStore });
        return toolResult({ eventId: result.event.id, nodeId: result.event.nodeId, phase: result.event.phase });
      }
    })
  ];
}

function toolResult(value: unknown): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(value))]);
}
