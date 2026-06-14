import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

const expectedCommands = [
  'agentflow.openPipeline',
  'agentflow.scanWorkspace',
  'agentflow.generateFiles',
  'agentflow.validatePipeline',
  'agentflow.createDefaultPipeline',
  'agentflow.playDemoActivity',
  'agentflow.copyDebugSnapshot',
  'agentflow.debugSnapshot'
];

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('marcmalerei.copilot-agent-flow-studio');
  assert.ok(extension, 'Agent Flow extension should be available in the extension host.');

  await extension.activate();

  const commands = await vscode.commands.getCommands(true);
  for (const command of expectedCommands) {
    assert.ok(commands.includes(command), `Expected command ${command} to be registered.`);
  }

  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(workspace, 'Smoke test should run with a workspace folder.');

  await vscode.commands.executeCommand('agentflow.createDefaultPipeline');
  await vscode.commands.executeCommand('agentflow.openPipeline');

  const openedSnapshot = await waitForSnapshot((snapshot) => snapshot.open && snapshot.nodeCount > 0);
  assert.ok(openedSnapshot.nodeIds.includes('router'), 'Open Agent Flow panel should load the default router node.');
  const renderedSnapshot = await waitForRenderedWebviewState();
  assert.ok(renderedSnapshot.webviewRenderedNodeCount && renderedSnapshot.webviewRenderedNodeCount > 0, 'Agent Flow webview should render React Flow nodes for the default pipeline.');
  assert.ok(renderedSnapshot.webviewVisibleNodeCount && renderedSnapshot.webviewVisibleNodeCount > 0, 'Agent Flow webview should keep at least one rendered node visible.');
  assert.equal(renderedSnapshot.webviewRuntimeError, undefined, 'Agent Flow webview should not report a runtime error after initial render.');
  const defaultNodeIds = [...renderedSnapshot.nodeIds];
  await delay(4_000);
  const stableDefaultSnapshot = await waitForRenderedWebviewState((snapshot) =>
    defaultNodeIds.every((nodeId) => snapshot.nodeIds.includes(nodeId))
    && snapshot.nodeCount >= defaultNodeIds.length
    && defaultNodeIds.every((nodeId) => snapshot.webviewNodeIds?.includes(nodeId))
    && defaultNodeIds.every((nodeId) => snapshot.webviewRenderedNodeIds?.includes(nodeId))
    && snapshot.webviewNodeCount === snapshot.nodeCount
    && snapshot.webviewRenderedNodeCount === snapshot.nodeCount, 2_000);
  assert.equal(stableDefaultSnapshot.webviewRuntimeError, undefined, 'Agent Flow webview should not report a runtime error after the default pipeline settles.');
  assert.equal(stableDefaultSnapshot.webviewNodeCount, stableDefaultSnapshot.nodeCount, 'Agent Flow webview should still hold every parsed default pipeline node after settling.');
  assert.equal(stableDefaultSnapshot.webviewRenderedNodeCount, stableDefaultSnapshot.nodeCount, 'Agent Flow webview should still render every parsed default pipeline node after settling.');
  assert.ok((stableDefaultSnapshot.webviewCanvasHeight ?? 0) >= 320, `Agent Flow webview canvas should not collapse after the default pipeline settles. Snapshot: ${JSON.stringify(stableDefaultSnapshot)}`);
  assert.ok((stableDefaultSnapshot.webviewVisibleNodeCount ?? 0) >= minimumUsefulVisibleNodeCount(stableDefaultSnapshot.nodeCount), 'Agent Flow webview should fit more than a tiny node cluster after the default pipeline settles.');
  assert.ok(defaultNodeIds.every((nodeId) => stableDefaultSnapshot.nodeIds.includes(nodeId)), 'Agent Flow webview should not lose default pipeline nodes after settling.');
  assert.ok(defaultNodeIds.every((nodeId) => stableDefaultSnapshot.webviewNodeIds?.includes(nodeId)), 'Agent Flow webview state should still include every default pipeline node after settling.');
  assert.ok(defaultNodeIds.every((nodeId) => stableDefaultSnapshot.webviewRenderedNodeIds?.includes(nodeId)), 'Agent Flow webview DOM should still include every default pipeline node after settling.');

  await assert.rejects(fs.readFile(path.join(workspace, '.github', 'agent-flow.json'), 'utf8'));
  assert.match(await fs.readFile(path.join(workspace, '.github/agents/router.agent.md'), 'utf8'), /name: "router"/);
  assert.match(await fs.readFile(path.join(workspace, '.github/artifacts/ROUTING.md'), 'utf8'), /# routing/i);
  assert.match(await fs.readFile(path.join(workspace, '.github/prompts/start-implementation.prompt.md'), 'utf8'), /name: "Start Implementation Prompt"/);
  assert.match(await fs.readFile(path.join(workspace, '.github/skills/ui-implementation/SKILL.md'), 'utf8'), /name: "ui-implementation"/);

  await fs.mkdir(path.join(workspace, '.github/agents'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.github/prompts'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.github/instructions'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.github/skills/smoke-skill'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.github/prompts/smoke-prompt.prompt.md'), `---
name: Smoke Prompt
agent: smoke-agent
tools:
  - read
---

# Smoke Prompt

- Read \`.github/artifacts/smoke.md\`: Read the smoke artifact before routing.
- Follow \`.github/instructions/smoke-instruction.instructions.md\`: Apply smoke rules.
`, 'utf8');
  await fs.writeFile(path.join(workspace, '.github/agents/smoke-agent.agent.md'), `---
name: Smoke Agent
tools:
  - read
  - search
---

# Smoke Agent

- Write \`.github/artifacts/smoke.md\`: Write the smoke result.
- Follow \`.github/instructions/smoke-instruction.instructions.md\`: Follow smoke rules.
`, 'utf8');
  await fs.writeFile(path.join(workspace, '.github/instructions/smoke-instruction.instructions.md'), `---
name: Smoke Instruction
applyTo: "**/*.md"
---

# Smoke Instruction
`, 'utf8');
  await fs.writeFile(path.join(workspace, '.github/skills/smoke-skill/SKILL.md'), `---
name: smoke-skill
description: Smoke skill description.
---

# Smoke Skill
`, 'utf8');
  await fs.writeFile(path.join(workspace, '.github/agents/smoke-live.agent.md'), `---
name: smoke-live
tools:
  - read/readFile
---

# Smoke Live
`, 'utf8');

  const refreshedSnapshot = await waitForSnapshot((snapshot) => snapshot.nodeIds.includes('smoke-live'));
  assert.ok(refreshedSnapshot.nodeCount >= openedSnapshot.nodeCount, 'File refresh should keep existing panel nodes while adding new file-backed nodes.');
  const renderedRefreshSnapshot = await waitForRenderedWebviewState((snapshot) => snapshot.nodeIds.includes('smoke-live'));
  assert.equal(renderedRefreshSnapshot.webviewStateVersion, renderedRefreshSnapshot.stateVersion, 'Webview should render the latest filesystem-refresh state, not a stale previous render.');
  assert.equal(renderedRefreshSnapshot.webviewRuntimeError, undefined, 'Agent Flow webview should not report a runtime error after filesystem refresh.');
  const refreshedNodeIds = [...renderedRefreshSnapshot.nodeIds];
  await delay(4_000);
  const stableRefreshSnapshot = await waitForRenderedWebviewState((snapshot) =>
    refreshedNodeIds.every((nodeId) => snapshot.nodeIds.includes(nodeId))
    && refreshedNodeIds.every((nodeId) => snapshot.webviewNodeIds?.includes(nodeId))
    && refreshedNodeIds.every((nodeId) => snapshot.webviewRenderedNodeIds?.includes(nodeId))
    && snapshot.webviewNodeCount === snapshot.nodeCount
    && snapshot.webviewRenderedNodeCount === snapshot.nodeCount, 2_000);
  assert.equal(stableRefreshSnapshot.webviewRuntimeError, undefined, 'Agent Flow webview should not report a runtime error after filesystem refresh settles.');
  assert.equal(stableRefreshSnapshot.webviewNodeCount, stableRefreshSnapshot.nodeCount, 'Agent Flow webview should still hold every parsed node after filesystem refresh settles.');
  assert.equal(stableRefreshSnapshot.webviewRenderedNodeCount, stableRefreshSnapshot.nodeCount, 'Agent Flow webview should still render every parsed node after filesystem refresh settles.');
  assert.ok((stableRefreshSnapshot.webviewCanvasHeight ?? 0) >= 320, `Agent Flow webview canvas should not collapse after filesystem refresh settles. Snapshot: ${JSON.stringify(stableRefreshSnapshot)}`);
  assert.ok((stableRefreshSnapshot.webviewVisibleNodeCount ?? 0) >= minimumUsefulVisibleNodeCount(stableRefreshSnapshot.nodeCount), 'Agent Flow webview should fit more than a tiny node cluster after filesystem refresh settles.');

  const originalShowWarningMessage = vscode.window.showWarningMessage;
  (vscode.window as unknown as { showWarningMessage: typeof vscode.window.showWarningMessage }).showWarningMessage = async (_message: string, ...items: unknown[]) => {
    const flatItems = items.flat().filter((item): item is string => typeof item === 'string');
    return flatItems.includes('Write Files') ? 'Write Files' : flatItems[0];
  };
  try {
    await vscode.commands.executeCommand('agentflow.generateFiles');
  } finally {
    (vscode.window as unknown as { showWarningMessage: typeof vscode.window.showWarningMessage }).showWarningMessage = originalShowWarningMessage;
  }

  const generatedAgent = await fs.readFile(path.join(workspace, '.github/agents/smoke-agent.agent.md'), 'utf8');
  const generatedPrompt = await fs.readFile(path.join(workspace, '.github/prompts/smoke-prompt.prompt.md'), 'utf8');
  const generatedInstruction = await fs.readFile(path.join(workspace, '.github/instructions/smoke-instruction.instructions.md'), 'utf8');
  const generatedSkill = await fs.readFile(path.join(workspace, '.github/skills/smoke-skill/SKILL.md'), 'utf8');
  const generatedArtifact = await fs.readFile(path.join(workspace, '.github/artifacts/smoke.md'), 'utf8');

  assert.match(generatedAgent, /name: "Smoke Agent"/);
  assert.match(generatedAgent, /- Write `\.github\/artifacts\/smoke\.md`: Write the smoke result\./);
  assert.match(generatedAgent, /- Follow `\.github\/instructions\/smoke-instruction\.instructions\.md`: Follow smoke rules\./);
  assert.match(generatedPrompt, /name: "Smoke Prompt"/);
  assert.match(generatedPrompt, /agent: "smoke-agent"/);
  assert.match(generatedPrompt, /- Read `\.github\/artifacts\/smoke\.md`: Read the smoke artifact before routing\./);
  assert.match(generatedPrompt, /- Follow `\.github\/instructions\/smoke-instruction\.instructions\.md`: Apply smoke rules\./);
  assert.match(generatedInstruction, /name: "Smoke Instruction"/);
  assert.match(generatedInstruction, /applyTo: "\*\*\/\*\.md"/);
  assert.match(generatedSkill, /name: "smoke-skill"/);
  assert.match(generatedSkill, /# Smoke Skill/);
  assert.match(generatedArtifact, /# \.github\/artifacts\/smoke\.md/);
}

interface DebugSnapshot {
  open: boolean;
  nodeIds: string[];
  nodeCount: number;
  stateVersion?: number;
  webviewStateVersion?: number;
  webviewNodeIds?: string[];
  webviewRenderedNodeIds?: string[];
  webviewNodeCount?: number;
  webviewRenderedNodeCount?: number;
  webviewVisibleNodeCount?: number;
  webviewCanvasHeight?: number;
  webviewRuntimeError?: string;
}

async function waitForRenderedWebviewState(extraPredicate: (snapshot: DebugSnapshot) => boolean = () => true, timeoutMs = 10_000): Promise<DebugSnapshot> {
  return waitForSnapshot((snapshot) =>
    typeof snapshot.stateVersion === 'number'
    && typeof snapshot.webviewStateVersion === 'number'
    && snapshot.webviewStateVersion === snapshot.stateVersion
    && (snapshot.webviewRenderedNodeCount ?? 0) > 0
    && (snapshot.webviewVisibleNodeCount ?? 0) > 0
    && extraPredicate(snapshot), timeoutMs);
}

async function waitForSnapshot(predicate: (snapshot: DebugSnapshot) => boolean, timeoutMs = 8000): Promise<DebugSnapshot> {
  const started = Date.now();
  let last: DebugSnapshot | undefined;
  while (Date.now() - started < timeoutMs) {
    last = await vscode.commands.executeCommand<DebugSnapshot>('agentflow.debugSnapshot');
    if (predicate(last)) return last;
    await delay(100);
  }
  assert.fail(`Timed out waiting for Agent Flow snapshot. Last snapshot: ${JSON.stringify(last)}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function minimumUsefulVisibleNodeCount(nodeCount: number): number {
  if (nodeCount <= 1) return nodeCount;
  return Math.min(nodeCount, Math.max(4, Math.ceil(nodeCount * 0.15)));
}
