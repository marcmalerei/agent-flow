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

  await fs.writeFile(pipelineFile, JSON.stringify({
    version: 1,
    name: 'Smoke generated files',
    nodes: [
      {
        id: 'new-prompt-1',
        type: 'prompt',
        label: 'Smoke Prompt',
        promptFile: '.github/prompts/new-prompt-1.prompt.md',
        startAgent: 'new-agent-1',
        tools: ['read'],
        requiredArtifacts: ['.agent-output/smoke.md'],
        artifactUsages: [{ path: '.agent-output/smoke.md', action: 'read', instruction: 'Read the smoke artifact before routing.' }],
        instructionRefs: [{ target: '.github/instructions/new-instruction-1.instructions.md', instruction: 'Apply smoke rules.' }]
      },
      {
        id: 'new-agent-1',
        type: 'agent',
        label: 'Smoke Agent',
        agentFile: '.github/agents/new-agent-1.agent.md',
        tools: ['read', 'search'],
        calls: [],
        inputs: ['.agent-output/smoke.md'],
        outputs: ['.agent-output/smoke.md'],
        artifactUsages: [{ path: '.agent-output/smoke.md', action: 'write', instruction: 'Write the smoke result.' }],
        instructionRefs: [{ target: '.github/instructions/new-instruction-1.instructions.md', instruction: 'Follow smoke rules.' }]
      },
      {
        id: 'new-instruction-1',
        type: 'instruction',
        label: 'Smoke Instruction',
        instructionFile: '.github/instructions/new-instruction-1.instructions.md',
        applyTo: '**/*.md',
        rules: ['Keep smoke files deterministic.']
      },
      {
        id: 'new-skill-1',
        type: 'skill',
        label: 'Smoke Skill',
        skillFile: '.github/skills/new-skill-1/SKILL.md',
        description: 'Smoke skill description.',
        procedure: ['Inspect generated files.']
      },
      {
        id: 'new-artifact-1',
        type: 'artifact',
        label: 'Smoke Artifact',
        path: '.agent-output/smoke.md'
      }
    ],
    edges: []
  }, null, 2), 'utf8');

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
  const generatedArtifact = await fs.readFile(path.join(workspace, '.agent-output/smoke.md'), 'utf8');

  assert.match(generatedAgent, /name: "Smoke Agent"/);
  assert.match(generatedAgent, /- Write `\.agent-output\/smoke\.md`: Write the smoke result\./);
  assert.match(generatedAgent, /- Follow `\.github\/instructions\/new-instruction-1\.instructions\.md`: Follow smoke rules\./);
  assert.match(generatedPrompt, /name: "Smoke Prompt"/);
  assert.match(generatedPrompt, /agent: "new-agent-1"/);
  assert.match(generatedPrompt, /- Read `\.agent-output\/smoke\.md`: Read the smoke artifact before routing\./);
  assert.match(generatedPrompt, /- Follow `\.github\/instructions\/new-instruction-1\.instructions\.md`: Apply smoke rules\./);
  assert.match(generatedInstruction, /name: "Smoke Instruction"/);
  assert.match(generatedInstruction, /applyTo: "\*\*\/\*\.md"/);
  assert.match(generatedSkill, /name: "smoke-skill"/);
  assert.match(generatedSkill, /# Smoke Skill/);
  assert.match(generatedArtifact, /# Smoke Artifact/);
}
