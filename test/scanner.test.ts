import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringifyPipeline } from '../src/pipeline/parser';
import { loadOrInferPipeline, inferPipelineFromWorkspace } from '../src/pipeline/scanner';
import { deriveVisibleFlowEdges } from '../src/webview/graph';

describe('workspace scanner', () => {
  it('parses role files and role references from agent markdown', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agentflow-roles-'));
    await fs.mkdir(path.join(workspace, '.github/agents'), { recursive: true });
    await fs.mkdir(path.join(workspace, '.github/roles'), { recursive: true });
    await fs.writeFile(path.join(workspace, '.github/roles/frontend-developer.md'), `---
name: "Frontend-Developer"
description: "Frontend developer role"
---

Markdown content...
`, 'utf8');
    await fs.writeFile(path.join(workspace, '.github/agents/frontend.agent.md'), `---
name: "Frontend"
---

# Role

Read \`.github/roles/frontend-developer.md\` before implementing UI changes.
`, 'utf8');

    const pipeline = await inferPipelineFromWorkspace(workspace);

    expect(pipeline.nodes.find((node) => node.id === 'frontend-developer' && node.type === 'role')).toMatchObject({
      roleFile: '.github/roles/frontend-developer.md',
      label: 'Frontend-Developer',
      description: 'Frontend developer role'
    });
    expect(pipeline.nodes.find((node) => node.id === 'frontend' && node.type === 'agent')).toMatchObject({
      roleRefs: [{ target: '.github/roles/frontend-developer.md' }]
    });
    expect(deriveVisibleFlowEdges(pipeline).map((edge) => [edge.source, edge.target, edge.label, edge.data.derivedFrom])).toContainEqual([
      'frontend-developer',
      'frontend',
      'role',
      'agent.roleRefs'
    ]);
  });

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

  it('adds newly created .github customization files when a persisted pipeline exists', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agentflow-live-new-file-'));
    await fs.mkdir(path.join(workspace, '.agent-pipeline'), { recursive: true });
    await fs.mkdir(path.join(workspace, '.github/agents'), { recursive: true });
    await fs.mkdir(path.join(workspace, '.github/prompts'), { recursive: true });
    await fs.mkdir(path.join(workspace, '.github/instructions'), { recursive: true });
    await fs.mkdir(path.join(workspace, '.github/skills/release-review'), { recursive: true });
    await fs.writeFile(path.join(workspace, '.agent-pipeline/pipeline.json'), stringifyPipeline({
      version: 1,
      name: 'Live sync',
      nodes: [
        { id: 'router', type: 'agent', label: 'Router', agentFile: '.github/agents/router.agent.md', tools: [], calls: [], inputs: [], outputs: [] }
      ],
      edges: []
    }), 'utf8');
    await fs.writeFile(path.join(workspace, '.github/agents/router.agent.md'), `---
name: Router
---

# Router
`, 'utf8');
    await fs.writeFile(path.join(workspace, '.github/agents/worker.agent.md'), `---
name: Worker
tools:
  - read
---

# Worker
`, 'utf8');
    await fs.writeFile(path.join(workspace, '.github/prompts/release-notes.prompt.md'), `---
name: Release Prompt
agent: worker
---

# Release
`, 'utf8');
    await fs.writeFile(path.join(workspace, '.github/instructions/release-policy.instructions.md'), `---
name: Release Instructions
applyTo: "**/*.md"
---

# Release Instructions
`, 'utf8');
    await fs.writeFile(path.join(workspace, '.github/skills/release-review/SKILL.md'), `---
name: Release Review
description: Review releases.
---

## Description
Review releases.
`, 'utf8');

    const pipeline = await loadOrInferPipeline(workspace);

    expect(pipeline.nodes.find((node) => node.id === 'worker' && node.type === 'agent')).toMatchObject({ agentFile: '.github/agents/worker.agent.md', tools: ['read'] });
    expect(pipeline.nodes.find((node) => node.id === 'release-notes' && node.type === 'prompt')).toMatchObject({ promptFile: '.github/prompts/release-notes.prompt.md' });
    expect(pipeline.nodes.find((node) => node.id === 'release-policy' && node.type === 'instruction')).toMatchObject({ instructionFile: '.github/instructions/release-policy.instructions.md' });
    expect(pipeline.nodes.find((node) => node.id === 'release-review' && node.type === 'skill')).toMatchObject({ skillFile: '.github/skills/release-review/SKILL.md' });
    expect(pipeline.edges).toContainEqual({ id: 'release-notes-starts-worker', from: 'release-notes', to: 'worker', kind: 'prompt' });
  });

  it('reflects renamed .github backing files on stale persisted nodes', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agentflow-live-rename-'));
    await fs.mkdir(path.join(workspace, '.agent-pipeline'), { recursive: true });
    await fs.mkdir(path.join(workspace, '.github/agents'), { recursive: true });
    await fs.writeFile(path.join(workspace, '.agent-pipeline/pipeline.json'), stringifyPipeline({
      version: 1,
      name: 'Live rename',
      nodes: [
        { id: 'router', type: 'agent', label: 'Router', agentFile: '.github/agents/router.agent.md', tools: [], calls: [], inputs: [], outputs: [] }
      ],
      edges: []
    }), 'utf8');
    await fs.writeFile(path.join(workspace, '.github/agents/review-router.agent.md'), `---
name: Review Router
tools:
  - read
---

# Review Router

Renamed file body.
`, 'utf8');

    const pipeline = await loadOrInferPipeline(workspace);
    const agent = pipeline.nodes.find((node) => node.id === 'review-router' && node.type === 'agent');

    expect(agent?.type).toBe('agent');
    expect(agent).toMatchObject({
      label: 'Review Router',
      agentFile: '.github/agents/review-router.agent.md',
      tools: ['read']
    });
    expect(agent?.markdown).toContain('Renamed file body.');
    expect(pipeline.nodes.filter((node) => node.type === 'agent')).toHaveLength(1);
    expect(pipeline.nodes.some((node) => node.id === 'router')).toBe(false);
  });

  it('ignores .github agent-flow JSON because Markdown files are the source of truth', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agentflow-view-state-'));
    await fs.mkdir(path.join(workspace, '.github/agents'), { recursive: true });
    await fs.writeFile(path.join(workspace, '.github/agent-flow.json'), JSON.stringify({
      version: 1,
      name: 'View State Only',
      nodes: [
        { id: 'router', type: 'agent', file: '.github/agents/router.agent.md', position: { x: 420, y: 260 } }
      ]
    }, null, 2), 'utf8');
    await fs.writeFile(path.join(workspace, '.github/agents/router.agent.md'), `---
name: Router
---

# Router
`, 'utf8');

    const pipeline = await loadOrInferPipeline(workspace);
    const router = pipeline.nodes.find((node) => node.id === 'router' && node.type === 'agent');

    expect(pipeline.name).toBe('Inferred Agent Pipeline');
    expect(router?.position).not.toEqual({ x: 420, y: 260 });
    expect(router?.markdown).toContain('# Router');
  });

  it('discovers filesystem-created .github nodes with frontmatter details', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agentflow-filesystem-created-'));
    await fs.mkdir(path.join(workspace, '.github/agents'), { recursive: true });
    await fs.mkdir(path.join(workspace, '.github/prompts'), { recursive: true });
    await fs.mkdir(path.join(workspace, '.github/instructions'), { recursive: true });
    await fs.mkdir(path.join(workspace, '.github/skills/review-pr'), { recursive: true });
    await fs.writeFile(path.join(workspace, '.github/agents/router.agent.md'), `---
name: Router
tools:
  - read
agents:
  - Worker
---

# Router
`, 'utf8');
    await fs.writeFile(path.join(workspace, '.github/agents/worker.agent.md'), `---
name: Worker
---

# Worker
`, 'utf8');
    await fs.writeFile(path.join(workspace, '.github/prompts/release-notes.prompt.md'), `---
name: Release Notes
agent: router
tools:
  - search
---

# Release Notes
`, 'utf8');
    await fs.writeFile(path.join(workspace, '.github/instructions/docs-policy.instructions.md'), `---
name: Documentation Policy
description: Use the docs voice.
applyTo: "**/*.md"
---

# Documentation Policy
`, 'utf8');
    await fs.writeFile(path.join(workspace, '.github/skills/review-pr/SKILL.md'), `---
name: Review PR
description: Review pull requests.
---

## Description
Review pull requests.
`, 'utf8');

    const pipeline = await loadOrInferPipeline(workspace);

    expect(pipeline.name).toBe('Inferred Agent Pipeline');
    expect(pipeline.nodes.find((node) => node.id === 'router' && node.type === 'agent')).toMatchObject({ label: 'Router', calls: ['worker'] });
    expect(pipeline.nodes.find((node) => node.id === 'worker' && node.type === 'agent')).toMatchObject({ label: 'Worker' });
    expect(pipeline.nodes.find((node) => node.id === 'release-notes' && node.type === 'prompt')).toMatchObject({ label: 'Release Notes', startAgent: 'router', tools: ['search'] });
    expect(pipeline.nodes.find((node) => node.id === 'docs-policy' && node.type === 'instruction')).toMatchObject({ label: 'Documentation Policy', description: 'Use the docs voice.', applyTo: '**/*.md' });
    expect(pipeline.nodes.find((node) => node.id === 'review-pr' && node.type === 'skill')).toMatchObject({ label: 'Review PR' });
    expect(pipeline.edges).toContainEqual({ id: 'router-calls-worker', from: 'router', to: 'worker', kind: 'flow' });
    expect(pipeline.edges).toContainEqual({ id: 'release-notes-starts-router', from: 'release-notes', to: 'router', kind: 'prompt' });
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

Write \`.github/artifacts/artifact-output.md\`

Read \`.github/artifacts/artifact-input.md\`

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
  expect(agent.outputs).toEqual(['.github/artifacts/artifact-output.md']);
  expect(agent.inputs).toEqual(['.github/artifacts/artifact-input.md']);
  expect(agent.instructionRefs).toEqual([{ target: '.github/instructions/*.instructions.md' }]);
  expect(pipeline.nodes.some((node) => node.type === 'artifact' && node.path === '.github/artifacts/artifact-output.md')).toBe(true);
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

<!-- Generated by Agent Flow. Manual changes may be overwritten. -->

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
Read \`.github/artifacts/result.md\`.
`, 'utf8');

  const pipeline = await inferPipelineFromWorkspace(workspace);
  const router = pipeline.nodes.find((node) => node.id === 'router' && node.type === 'agent');

  expect(router?.type).toBe('agent');
  expect(router?.calls).toEqual(['worker']);
  expect(pipeline.nodes.find((node) => node.id === 'worker')?.type).toBe('agent');
  expect(pipeline.nodes.find((node) => node.id === 'build')?.type).toBe('prompt');
  expect(pipeline.nodes.find((node) => node.id === 'template')?.type).toBe('instruction');
  expect(pipeline.nodes.some((node) => node.type === 'artifact' && ['.github/agents/worker.agent.md', '.github/prompts/build.prompt.md', '.github/instructions/template.instructions.md'].includes(node.path))).toBe(false);
  expect(pipeline.nodes.some((node) => node.type === 'artifact' && node.path === '.github/artifacts/result.md')).toBe(true);
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

Read \`.github/artifacts/manual.md\`.
Read \`.github/instructions/manual.instructions.md\`.
`, 'utf8');

  const pipeline = await loadOrInferPipeline(workspace);
  const router = pipeline.nodes.find((node) => node.id === 'router' && node.type === 'agent');

  expect(router?.type).toBe('agent');
  expect(router?.inputs).toEqual(['.github/artifacts/manual.md']);
  expect(router?.instructionRefs).toEqual([{ target: '.github/instructions/manual.instructions.md' }]);
  expect(pipeline.nodes.some((node) => node.type === 'artifact' && node.path === '.github/artifacts/manual.md')).toBe(true);
  expect(pipeline.nodes.find((node) => node.id === 'manual')?.type).toBe('instruction');
});

it('treats referenced .github skills directory SKILL.md files as skill nodes, not artifacts', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agentflow-skill-ref-'));
  await fs.mkdir(path.join(workspace, '.github/agents'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.github/agents/router.agent.md'), `---
name: Router
---

# Router

Read \`.github/skills/repo-audit/SKILL.md\`.
Read \`.github/skills/not-a-skill.skill.md\`.
`, 'utf8');

  const pipeline = await inferPipelineFromWorkspace(workspace);

  expect(pipeline.nodes.find((node) => node.id === 'repo-audit')?.type).toBe('skill');
  expect(pipeline.nodes.some((node) => node.type === 'artifact' && node.path === '.github/skills/repo-audit/SKILL.md')).toBe(false);
  expect(pipeline.nodes.some((node) => node.type === 'skill' && 'skillFile' in node && node.skillFile === '.github/skills/not-a-skill.skill.md')).toBe(false);
});

it('uses prompt frontmatter agent references for prompt-to-agent edges', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agentflow-prompt-agent-'));
  await fs.mkdir(path.join(workspace, '.github/agents'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.github/prompts'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.github/agents/router.agent.md'), `---
name: Router
---

# Router
`, 'utf8');
  await fs.writeFile(path.join(workspace, '.github/prompts/kickoff.prompt.md'), `---
name: Kickoff
agent: .github/agents/router.agent.md
---

# Kickoff

No body start line here.
`, 'utf8');

  const pipeline = await inferPipelineFromWorkspace(workspace);
  const prompt = pipeline.nodes.find((node) => node.id === 'kickoff' && node.type === 'prompt');

  expect(prompt?.type).toBe('prompt');
  expect(prompt?.startAgent).toBe('router');
  expect(pipeline.edges).toContainEqual({ id: 'kickoff-starts-router', from: 'kickoff', to: 'router', kind: 'prompt' });
  expect(deriveVisibleFlowEdges(pipeline).filter((edge) => edge.source === 'kickoff' && edge.target === 'router')).toHaveLength(1);
});
