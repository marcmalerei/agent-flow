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

  const viewStateFile = path.join(workspace, '.github', 'agent-flow.json');
  const viewState = JSON.parse(await fs.readFile(viewStateFile, 'utf8')) as {
    version?: unknown;
    name?: unknown;
    nodes?: unknown[];
  };

  assert.equal(viewState.version, 1);
  assert.equal(viewState.name, 'Default Agent Pipeline');
  assert.ok(Array.isArray(viewState.nodes) && viewState.nodes.length > 0, 'Default view state should include nodes.');
  assert.match(await fs.readFile(path.join(workspace, '.github/agents/router.agent.md'), 'utf8'), /name: "Router"/);

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

- Read \`.agent-output/smoke.md\`: Read the smoke artifact before routing.
- Follow \`.github/instructions/smoke-instruction.instructions.md\`: Apply smoke rules.
`, 'utf8');
  await fs.writeFile(path.join(workspace, '.github/agents/smoke-agent.agent.md'), `---
name: Smoke Agent
tools:
  - read
  - search
---

# Smoke Agent

- Write \`.agent-output/smoke.md\`: Write the smoke result.
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
  assert.match(generatedAgent, /- Follow `\.github\/instructions\/smoke-instruction\.instructions\.md`: Follow smoke rules\./);
  assert.match(generatedPrompt, /name: "Smoke Prompt"/);
  assert.match(generatedPrompt, /agent: "smoke-agent"/);
  assert.match(generatedPrompt, /- Read `\.agent-output\/smoke\.md`: Read the smoke artifact before routing\./);
  assert.match(generatedPrompt, /- Follow `\.github\/instructions\/smoke-instruction\.instructions\.md`: Apply smoke rules\./);
  assert.match(generatedInstruction, /name: "Smoke Instruction"/);
  assert.match(generatedInstruction, /applyTo: "\*\*\/\*\.md"/);
  assert.match(generatedSkill, /name: "smoke-skill"/);
  assert.match(generatedSkill, /# Smoke Skill/);
  assert.match(generatedArtifact, /# \.agent-output\/smoke\.md/);
}
