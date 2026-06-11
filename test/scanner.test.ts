import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringifyPipeline } from '../src/pipeline/parser';
import { loadOrInferPipeline, inferPipelineFromWorkspace } from '../src/pipeline/scanner';
import { deriveVisibleFlowEdges } from '../src/webview/graph';

describe('workspace scanner', () => {
  it('parses agent handoffs from frontmatter object lists', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agentflow-handoffs-'));
    await fs.mkdir(path.join(workspace, '.github/agents'), { recursive: true });
    await fs.writeFile(path.join(workspace, '.github/agents/router.agent.md'), `---
name: Router
tools:
  - read
agents:
  - worker
handoffs:
  - label: "Escalate to Worker"
    agent: "Worker"
    prompt: "Take over this request."
    send: false
    model: "gpt-5"
---

# Router
`, 'utf8');
    await fs.writeFile(path.join(workspace, '.github/agents/worker.agent.md'), `---
name: Worker
---

# Worker
`, 'utf8');

    const pipeline = await inferPipelineFromWorkspace(workspace);
    const router = pipeline.nodes.find((node) => node.id === 'router');

    expect(router?.type).toBe('agent');
    if (router?.type !== 'agent') throw new Error('router agent missing');
    expect(router.handoffs).toEqual([
      { label: 'Escalate to Worker', agent: 'Worker', prompt: 'Take over this request.', send: false, model: 'gpt-5' }
    ]);
    expect(pipeline.edges).toContainEqual({
      id: 'router-handoff-worker-escalate-to-worker',
      from: 'router',
      to: 'worker',
      kind: 'handoff',
      label: 'Escalate to Worker'
    });
  });

  it('hydrates renamed new node markdown from generated label-based paths', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agentflow-new-node-path-'));
    await fs.mkdir(path.join(workspace, '.agent-pipeline'), { recursive: true });
    await fs.mkdir(path.join(workspace, '.github/agents'), { recursive: true });
    await fs.writeFile(path.join(workspace, '.agent-pipeline/pipeline.json'), stringifyPipeline({
      version: 1,
      name: 'New node path',
      nodes: [
        { id: 'new-agent-1', type: 'agent', label: 'Security Reviewer', agentFile: '.github/agents/new-agent-1.agent.md', tools: [], calls: [], outputs: [] }
      ],
      edges: []
    }), 'utf8');
    await fs.writeFile(path.join(workspace, '.github/agents/security-reviewer.agent.md'), '# Security Reviewer\n\nHydrated body.\n', 'utf8');

    const pipeline = await loadOrInferPipeline(workspace);
    const agent = pipeline.nodes[0];

    expect(agent.type).toBe('agent');
    expect(agent.markdown).toContain('Hydrated body.');
  });
});

it('parses VS Code agent frontmatter, markdown file references, hooks, and MCP servers', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agentflow-vscode-schema-'));
  await fs.mkdir(path.join(workspace, '.github/agents'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.github/instructions'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.github/instructions/docs.instructions.md'), '---\napplyTo: docs/**/*.md\n---\n\n# Docs\n', 'utf8');
  await fs.writeFile(path.join(workspace, '.github/agents/full-blown-feature.agent.md'), `---
name: full-blown-feature
description: A brief description shown as placeholder text in the chat input field.
argument-hint: Describe the feature you want to implement
model:
  - GPT-5 (copilot)
  - Claude Sonnet 4.5 (copilot)
target: vscode
user-invocable: true
disable-model-invocation: false
tools:
  - agent
  - browser
  - edit
agents:
  - "*"
handoffs:
  - label: Start Code Review
    agent: example-subagent
    prompt: Please review the implementation above for quality and security issues.
    send: false
    model: GPT-4o (copilot)
hooks:
  SessionStart:
    - type: command
      command: echo "Agent started"
mcp-servers:
  - name: my-server
    command: npx
    args: ["-y","my-mcp-server"]
---

# Full Blown Feature

Write \`.agent-output/artifact-output.md\`

Read \`.agent-output/artifact-input.md\`

# Referenced instructions

- Follow \`.github/instructions/*.instructions.md\`.
`, 'utf8');

  const pipeline = await inferPipelineFromWorkspace(workspace);
  const agent = pipeline.nodes.find((node) => node.id === 'full-blown-feature');

  expect(agent?.type).toBe('agent');
  if (agent?.type !== 'agent') throw new Error('agent missing');
  expect(agent.argumentHint).toBe('Describe the feature you want to implement');
  expect(agent.model).toEqual(['GPT-5 (copilot)', 'Claude Sonnet 4.5 (copilot)']);
  expect(agent.target).toBe('vscode');
  expect(agent.userInvocable).toBe(true);
  expect(agent.disableModelInvocation).toBe(false);
  expect(agent.tools).toEqual(['agent', 'browser', 'edit']);
  expect(agent.calls).toEqual(['*']);
  expect(agent.hooks).toEqual({ SessionStart: [{ type: 'command', command: 'echo "Agent started"' }] });
  expect(agent.mcpServers).toEqual([{ name: 'my-server', command: 'npx', args: '["-y","my-mcp-server"]' }]);
  expect(agent.outputs).toEqual(['.agent-output/artifact-output.md']);
  expect(agent.inputs).toEqual(['.agent-output/artifact-input.md']);
  expect(agent.instructionRefs).toEqual([{ target: '.github/instructions/*.instructions.md' }]);
  expect(pipeline.nodes.some((node) => node.type === 'artifact' && node.path === '.agent-output/artifact-output.md')).toBe(true);
  expect(pipeline.nodes.some((node) => node.type === 'hook' && node.label === 'SessionStart hook')).toBe(true);
  expect(pipeline.nodes.some((node) => node.type === 'mcp-server' && node.label === 'my-server')).toBe(true);
});


it('infers instruction-to-instruction references from markdown code spans', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agentflow-instruction-refs-'));
  await fs.mkdir(path.join(workspace, '.github/instructions'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.github/instructions/atom.instructions.md'), `---
name: "Atom"
description: "Atom instructions"
applyTo: "!**/*"
---

# Atom

Describe this instruction node.

<!-- Generated by AgentFlow. Manual changes may be overwritten. -->

If required read \`.github/instructions/template.instructions.md\`.
`, 'utf8');
  await fs.writeFile(path.join(workspace, '.github/instructions/template.instructions.md'), `---
name: Template
applyTo: "**/*"
---

# Template
`, 'utf8');

  const pipeline = await inferPipelineFromWorkspace(workspace);
  const atom = pipeline.nodes.find((node) => node.id === 'atom');

  expect(atom?.type).toBe('instruction');
  if (atom?.type !== 'instruction') throw new Error('atom instruction missing');
  expect(atom.instructionRefs).toEqual([{ target: '.github/instructions/template.instructions.md' }]);
  expect(pipeline.edges.filter((edge) => edge.kind === 'instruction')).toEqual([]);
  expect(deriveVisibleFlowEdges(pipeline).filter((edge) => edge.source === 'template' && edge.target === 'atom')).toHaveLength(1);
});

it('treats referenced agent, prompt, and instruction markdown as customization nodes, not artifacts', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agentflow-customization-refs-'));
  await fs.mkdir(path.join(workspace, '.github/agents'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.github/agents/router.agent.md'), `---
name: Router
agents:
  - .github/agents/worker.agent.md
handoffs:
  - label: Continue in worker
    agent: .github/agents/worker.agent.md
---

# Router

Read \`.github/agents/worker.agent.md\`.
Read \`.github/prompts/build.prompt.md\`.
Read \`.github/instructions/template.instructions.md\`.
Read \`.agent-output/result.md\`.
`, 'utf8');

  const pipeline = await inferPipelineFromWorkspace(workspace);
  const router = pipeline.nodes.find((node) => node.id === 'router' && node.type === 'agent');

  expect(router?.type).toBe('agent');
  expect(router?.calls).toEqual(['worker']);
  expect(pipeline.nodes.find((node) => node.id === 'worker')?.type).toBe('agent');
  expect(pipeline.nodes.find((node) => node.id === 'build')?.type).toBe('prompt');
  expect(pipeline.nodes.find((node) => node.id === 'template')?.type).toBe('instruction');
  expect(pipeline.nodes.some((node) => node.type === 'artifact' && ['.github/agents/worker.agent.md', '.github/prompts/build.prompt.md', '.github/instructions/template.instructions.md'].includes(node.path))).toBe(false);
  expect(pipeline.nodes.some((node) => node.type === 'artifact' && node.path === '.agent-output/result.md')).toBe(true);
});

it('reloads file-backed pipeline nodes from manual markdown edits when pipeline JSON exists', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agentflow-hydrate-refs-'));
  await fs.mkdir(path.join(workspace, '.agent-pipeline'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.github/agents'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.agent-pipeline/pipeline.json'), stringifyPipeline({
    version: 1,
    name: 'Hydrate markdown refs',
    nodes: [
      { id: 'router', type: 'agent', label: 'Router', agentFile: '.github/agents/router.agent.md', tools: [], calls: [], inputs: [], outputs: [] }
    ],
    edges: []
  }), 'utf8');
  await fs.writeFile(path.join(workspace, '.github/agents/router.agent.md'), `---
name: Router
---

# Router

Read \`.agent-output/manual.md\`.
Read \`.github/instructions/manual.instructions.md\`.
`, 'utf8');

  const pipeline = await loadOrInferPipeline(workspace);
  const router = pipeline.nodes.find((node) => node.id === 'router' && node.type === 'agent');

  expect(router?.type).toBe('agent');
  expect(router?.inputs).toEqual(['.agent-output/manual.md']);
  expect(router?.instructionRefs).toEqual([{ target: '.github/instructions/manual.instructions.md' }]);
  expect(pipeline.nodes.some((node) => node.type === 'artifact' && node.path === '.agent-output/manual.md')).toBe(true);
  expect(pipeline.nodes.find((node) => node.id === 'manual')?.type).toBe('instruction');
});
