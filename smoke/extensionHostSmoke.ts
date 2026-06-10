import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

const expectedCommands = [
  'agentflow.openPipeline',
  'agentflow.scanWorkspace',
  'agentflow.generateFiles',
  'agentflow.validatePipeline',
  'agentflow.createDefaultPipeline'
];

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('marcmalerei.agentflow');
  assert.ok(extension, 'AgentFlow extension should be available in the extension host.');

  await extension.activate();

  const commands = await vscode.commands.getCommands(true);
  for (const command of expectedCommands) {
    assert.ok(commands.includes(command), `Expected command ${command} to be registered.`);
  }

  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(workspace, 'Smoke test should run with a workspace folder.');

  await vscode.commands.executeCommand('agentflow.createDefaultPipeline');

  const pipelineFile = path.join(workspace, '.agent-pipeline', 'pipeline.json');
  const pipeline = JSON.parse(await fs.readFile(pipelineFile, 'utf8')) as {
    version?: unknown;
    name?: unknown;
    nodes?: unknown[];
    edges?: unknown[];
  };

  assert.equal(pipeline.version, 1);
  assert.equal(pipeline.name, 'Default Agent Pipeline');
  assert.ok(Array.isArray(pipeline.nodes) && pipeline.nodes.length > 0, 'Default pipeline should include nodes.');
  assert.ok(Array.isArray(pipeline.edges) && pipeline.edges.length > 0, 'Default pipeline should include edges.');
}
