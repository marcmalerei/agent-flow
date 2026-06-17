import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDefaultPipeline, createDefaultPipelineDemoScript } from '../src/pipeline/defaultPipeline';
import { parsePipelineJson, stringifyPipeline } from '../src/pipeline/parser';
import { generateAgentMarkdown, generateFiles, generateInstructionMarkdown, generatePromptMarkdown, generateRoleMarkdown, generateSkillMarkdown } from '../src/pipeline/generators';
import { validatePipeline } from '../src/pipeline/validator';
import { calculateRiskScore } from '../src/pipeline/riskScore';
import { AgentPipeline, PromptNode } from '../src/pipeline/types';
import { normalizePipelineAgentReferences, resolveAgentReference, stripYamlQuotes } from '../src/pipeline/referenceResolver';
import { inferPipelineFromWorkspace } from '../src/pipeline/scanner';
import { deriveVisibleFlowEdges } from '../src/webview/graph';
import { coerceFlowLayout, flowLayoutLane, layoutFlowNodes } from '../src/webview/flowLayout';
import { estimateNodeTokenCount, estimateTokenCount, formatTokenBadge } from '../src/webview/tokenCounts';
import { renameNodeLabel } from '../src/webview/flowMutations';

async function writeGeneratedMarkdown(workspace: string, pipeline: AgentPipeline): Promise<void> {
  for (const file of generateFiles(pipeline).filter((item) => item.kind !== 'pipeline')) {
    const target = path.join(workspace, file.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content, 'utf8');
  }
}

describe('pipeline parsing', () => {
  it('round-trips the default pipeline schema', () => {
    const pipeline = createDefaultPipeline();
    const parsed = parsePipelineJson(stringifyPipeline(pipeline));
    expect(parsed.version).toBe(1);
    expect(parsed.nodes.length).toBeGreaterThan(10);
    expect(parsed.edges.length).toBeGreaterThan(3);
  });

  it('rejects duplicate node ids', () => {
    const pipeline = createDefaultPipeline();
    pipeline.nodes.push({ ...pipeline.nodes[0] });
    expect(() => parsePipelineJson(JSON.stringify(pipeline))).toThrow(/duplicate node id/);
  });
});

describe('default pipeline', () => {
  it('keeps the default pipeline compact and focused', () => {
    const pipeline = createDefaultPipeline();
    const ids = pipeline.nodes.map((node) => node.id);
    for (const id of ['router', 'implementer', 'reviewer', 'fixer']) {
      expect(ids).toContain(id);
    }
    expect(pipeline.nodes.filter((node) => node.type === 'agent').length).toBeLessThanOrEqual(5);
    expect(pipeline.nodes.filter((node) => node.type === 'artifact').length).toBeLessThanOrEqual(3);
    expect(pipeline.nodes.filter((node) => node.type === 'instruction').length).toBeLessThanOrEqual(3);
    expect(pipeline.nodes.filter((node) => node.type === 'handoff').length).toBeGreaterThanOrEqual(1);
  });

  it('uses lower-case default names and labels', () => {
    const pipeline = createDefaultPipeline();

    expect(pipeline.name).toBe(pipeline.name.toLowerCase());
    for (const node of pipeline.nodes) {
      expect(node.label).toBe(node.label.toLowerCase());
      if (node.type === 'agent') expect(generateAgentMarkdown(node)).toContain(`name: "${node.label}"`);
      if (node.type === 'prompt') expect(generatePromptMarkdown(node)).toContain(`name: "${node.label}"`);
    }
  });

  it('shows the default pipeline as a readable first-run graph', () => {
    const pipeline = createDefaultPipeline();
    const edges = deriveVisibleFlowEdges(pipeline);
    const positions = layoutFlowNodes(pipeline, 'compact');
    const xs = [...positions.values()].map((position) => position.x);
    const ys = [...positions.values()].map((position) => position.y);

    expect(edges.some((edge) => edge.data.kind === 'handoff')).toBe(true);
    expect(edges.some((edge) => edge.data.derivedFrom === 'handoff.targetAgent')).toBe(true);
    expect(edges.some((edge) => edge.data.derivedFrom.includes('artifact'))).toBe(true);
    expect(edges.some((edge) => edge.data.derivedFrom.includes('instructionRefs'))).toBe(true);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(285 * 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(900);
  });

  it('contains artifact nodes for all default artifact references', () => {
    const pipeline = createDefaultPipeline();
    const referencedArtifacts = new Set<string>();
    for (const node of pipeline.nodes) {
      if (node.type === 'prompt') for (const artifact of node.requiredArtifacts ?? []) referencedArtifacts.add(artifact);
      if (node.type === 'agent') {
        for (const artifact of node.inputs ?? []) referencedArtifacts.add(artifact);
        for (const artifact of node.outputs ?? []) referencedArtifacts.add(artifact);
      }
    }
    for (const edge of pipeline.edges) {
      if (edge.artifact) referencedArtifacts.add(edge.artifact);
    }

    const artifactNodes = new Set(pipeline.nodes.filter((node) => node.type === 'artifact').map((node) => node.path));
    const generatedArtifacts = new Set(generateFiles(pipeline).filter((file) => file.kind === 'artifact').map((file) => file.path));

    for (const artifact of referencedArtifacts) {
      expect(artifactNodes).toContain(artifact);
      expect(generatedArtifacts).toContain(artifact);
    }
  });

  it('uses concrete VS Code tool ids in default tool lists', () => {
    const pipeline = createDefaultPipeline();
    const toolNodes = pipeline.nodes.filter((node) => (node.type === 'agent' || node.type === 'prompt') && node.tools?.length);

    expect(toolNodes.length).toBeGreaterThan(0);
    for (const node of toolNodes) {
      expect(node.tools).not.toEqual(expect.arrayContaining(['read', 'search', 'edit', 'execute']));
      if (node.type === 'agent' && ((node.calls?.length ?? 0) > 0 || (node.handoffs?.length ?? 0) > 0)) {
        expect(node.tools).toContain('agent');
      }
      if (node.type === 'agent' && ((node.outputs?.length ?? 0) > 0 || node.artifactUsages?.some((usage) => usage.action === 'write' || usage.action === 'append'))) {
        expect(node.tools).toContain('edit/editFiles');
      }
    }
    expect(toolNodes.flatMap((node) => node.tools ?? [])).toEqual(expect.arrayContaining([
      'read/readFile',
      'search/searchWorkspaceSymbols',
      'edit/editFiles',
      'execute/run_in_terminal',
      'agentflow_report_activity',
      'agentflow_complete_node'
    ]));
  });

  it('defines handoffs for every default agent subagent call', () => {
    const agents = createDefaultPipeline().nodes.filter((node) => node.type === 'agent');

    for (const agent of agents) {
      const calls = agent.calls ?? [];
      if (calls.length === 0) continue;

      expect(agent.handoffs?.map((handoff) => handoff.agent).sort()).toEqual([...calls].sort());
      const markdown = generateAgentMarkdown(agent);
      expect(markdown).toContain('handoffs:');
      for (const call of calls) {
        expect(markdown).toContain(`agent: "${call}"`);
      }
    }
  });

  it('treats prompt artifact usage as a default artifact boundary', () => {
    const ids = validatePipeline(createDefaultPipeline()).map((finding) => finding.ruleId);

    expect(ids).not.toContain('artifact-read-never-written');
  });

  it('can be regenerated from its Markdown files with visible references intact', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agentflow-default-'));
    await writeGeneratedMarkdown(workspace, createDefaultPipeline());

    const inferred = await inferPipelineFromWorkspace(workspace);
    const visibleEdges = deriveVisibleFlowEdges(inferred);

    expect(validatePipeline(inferred).filter((finding) => finding.severity === 'error')).toEqual([]);
    expect(inferred.nodes.filter((node) => node.type === 'agent').length).toBeLessThanOrEqual(5);
    expect(inferred.nodes.filter((node) => node.type === 'artifact').length).toBeLessThanOrEqual(3);
    expect(inferred.nodes.filter((node) => node.type === 'instruction').length).toBeLessThanOrEqual(3);
    expect(visibleEdges.some((edge) => edge.data.kind === 'handoff')).toBe(true);
    expect(visibleEdges.some((edge) => edge.data.derivedFrom.includes('artifact'))).toBe(true);
    expect(visibleEdges.some((edge) => edge.data.derivedFrom.includes('instructionRefs'))).toBe(true);
  });

  it('provides a guided product demo script for first-run and Marketplace capture', () => {
    const steps = createDefaultPipelineDemoScript();

    expect(steps.map((step) => step.id)).toEqual([
      'create-default-pipeline',
      'read-overview',
      'create-context-node',
      'edit-reference',
      'replay-demo-activity'
    ]);
    expect(steps.find((step) => step.id === 'create-default-pipeline')?.command).toBe('agentflow.createDefaultPipeline');
    expect(steps.find((step) => step.id === 'replay-demo-activity')?.command).toBe('agentflow.playDemoActivity');
    expect(steps.map((step) => `${step.action} ${step.expectedOutcome}`).join('\n')).toContain('node creation');
    expect(steps.map((step) => `${step.action} ${step.expectedOutcome}`).join('\n')).toContain('reference editing');
    expect(steps.map((step) => `${step.action} ${step.expectedOutcome}`).join('\n')).toContain('resulting edges');
  });
});

describe('markdown generators', () => {
  const pipeline = createDefaultPipeline();
  it('generates deterministic agent markdown with marker and artifacts', () => {
    const implementer = pipeline.nodes.find((node) => node.id === 'implementer' && node.type === 'agent');
    expect(implementer?.type).toBe('agent');
    const first = generateAgentMarkdown(implementer!);
    const second = generateAgentMarkdown(implementer!);
    expect(first).toBe(second);
    expect(first).toContain('<!-- Generated by Agent Flow');
    expect(first).toContain('Write `.github/artifacts/result.md`.');
  });

  it('keeps generated comments after frontmatter so VS Code highlights YAML correctly', () => {
    const implementer = pipeline.nodes.find((node) => node.id === 'implementer' && node.type === 'agent');
    const promptNode = pipeline.nodes.find((node): node is PromptNode => node.type === 'prompt');
    expect(implementer?.type).toBe('agent');
    expect(promptNode).toBeDefined();
    const agent = generateAgentMarkdown(implementer!);
    const prompt = generatePromptMarkdown(promptNode!);
    const instruction = generateInstructionMarkdown({ id: 'docs', type: 'instruction', label: 'Docs', applyTo: 'docs/**/*.md' });
    const skill = generateSkillMarkdown({ id: 'review-pr', type: 'skill', label: 'Review PR', description: 'Review changes.' });
    const role = generateRoleMarkdown({ id: 'frontend-developer', type: 'role', label: 'Frontend-Developer', description: 'Frontend developer role' });
    const artifact = generateFiles({ version: 1, name: 'Artifacts', nodes: [{ id: 'result', type: 'artifact', label: 'Result', path: '.github/artifacts/result.md' }], edges: [] }).find((file) => file.kind === 'artifact')?.content ?? '';

    for (const markdown of [agent, prompt, instruction, skill, role]) {
      expect(markdown.startsWith('---\n')).toBe(true);
      expect(markdown.trimEnd().endsWith('<!-- Generated by Agent Flow. Manual changes may be overwritten. -->')).toBe(true);
    }
    expect(artifact.startsWith('# result\n')).toBe(true);
    expect(artifact.trimEnd().endsWith('<!-- Generated by Agent Flow. Manual changes may be overwritten. -->')).toBe(true);
  });

  it('does not duplicate generated comments when preserving edited markdown bodies', () => {
    const agent = generateAgentMarkdown({
      id: 'reviewer',
      type: 'agent',
      label: 'Reviewer',
      description: 'Reviews changes.',
      tools: ['read'],
      markdown: `---
name: "Reviewer"
tools:
  - "read"
---

# Custom Body

Keep this prose.

<!-- Generated by Agent Flow. Manual changes may be overwritten. -->`
    });

    expect(agent.match(/Generated by Agent Flow/g)).toHaveLength(1);
    expect(agent.startsWith('---\n')).toBe(true);
    expect(agent.trimEnd().endsWith('<!-- Generated by Agent Flow. Manual changes may be overwritten. -->')).toBe(true);
  });

  it('generates current custom agent frontmatter fields', () => {
    const agent = generateAgentMarkdown({
      id: 'reviewer',
      type: 'agent',
      label: 'Reviewer',
      description: 'Reviews changes.',
      tools: ['search'],
      calls: ['implementer'],
      argumentHint: '[pull request]',
      model: 'GPT-5.2 (copilot)',
      target: 'vscode',
      userInvocable: false,
      disableModelInvocation: true,
      handoffs: [{ label: 'Start Implementation', agent: 'implementer', prompt: 'Implement the review findings.', send: false }]
    });
    expect(agent).toContain('name: "reviewer"');
    expect(agent).toContain('argument-hint: "[pull request]"');
    expect(agent).toContain('model: "GPT-5.2 (copilot)"');
    expect(agent).toContain('target: "vscode"');
    expect(agent).toContain('user-invocable: false');
    expect(agent).toContain('disable-model-invocation: true');
    expect(agent).toContain('agents:\n  - "implementer"');
    expect(agent).toContain('handoffs:\n  - label: "Start Implementation"\n    agent: "implementer"\n    prompt: "Implement the review findings."\n    send: false');
  });

  it('omits empty optional frontmatter fields', () => {
    const agent = generateAgentMarkdown({ id: 'agent', type: 'agent', label: 'Agent', description: '', tools: [], calls: [] });
    const prompt = generatePromptMarkdown({ id: 'prompt', type: 'prompt', label: 'Prompt', description: '', tools: [] });
    const instruction = generateInstructionMarkdown({ id: 'instruction', type: 'instruction', label: 'Instruction', description: '', applyTo: '', rules: [] });
    const skill = generateSkillMarkdown({ id: 'skill', type: 'skill', label: 'Skill', description: '', argumentHint: '', procedure: [] });

    for (const markdown of [agent, prompt, instruction, skill]) {
      expect(markdown).not.toContain('description:');
      expect(markdown).not.toContain('argument-hint:');
    }
    expect(instruction).not.toContain('applyTo:');
  });

  it('generates prompt markdown', () => {
    const prompt = pipeline.nodes.find((node) => node.type === 'prompt');
    expect(prompt?.type).toBe('prompt');
    expect(generatePromptMarkdown(prompt!)).toContain('Start with `router`.');
  });

  it('generates current prompt file frontmatter fields', () => {
    const prompt = generatePromptMarkdown({
      id: 'security-review',
      type: 'prompt',
      label: 'Security Review',
      description: 'Review a REST API.',
      startAgent: 'ask',
      argumentHint: '[endpoint]',
      model: 'Claude Sonnet 4',
      tools: ['search']
    });
    expect(prompt).toContain('name: "security review"');
    expect(prompt).toContain('argument-hint: "[endpoint]"');
    expect(prompt).toContain('agent: "ask"');
    expect(prompt).toContain('model: "Claude Sonnet 4"');
    expect(prompt).toContain('tools:\n  - "search"');
  });

  it('generates instruction markdown', () => {
    const instruction = generateInstructionMarkdown({ id: 'docs', type: 'instruction', label: 'Docs', description: 'Markdown standards.', applyTo: '**/*.md', excludeAgent: 'code-review', rules: ['Keep docs short.'] });
    expect(instruction).toContain('name: "docs"');
    expect(instruction).toContain('description: "Markdown standards."');
    expect(instruction).toContain('applyTo: "**/*.md"');
    expect(instruction).toContain('excludeAgent: "code-review"');
  });

  it('generates skill markdown with activation criteria', () => {
    expect(generateSkillMarkdown({
      id: 'vitest-testing',
      type: 'skill',
      label: 'Vitest Testing',
      description: 'Use for focused Vitest test creation and debugging.',
      activationCriteria: ['A TypeScript unit test is needed.']
    })).toContain('## Activation criteria');
  });

  it('generates role markdown', () => {
    const role = generateRoleMarkdown({
      id: 'frontend-developer',
      type: 'role',
      label: 'Frontend-Developer',
      description: 'Frontend developer role'
    });

    expect(role).toContain('name: "frontend-developer"');
    expect(role).toContain('description: "Frontend developer role"');
    expect(role).toContain('# frontend-developer');
    expect(role).toContain('Frontend developer role');
  });

  it('does not generate flow JSON because Markdown files are the source of truth', () => {
    expect(generateFiles({ version: 1, name: 'Path', nodes: [], edges: [] }).some((file) => file.kind === 'pipeline' || file.path === '.github/agent-flow.json')).toBe(false);
  });

  it('generates current skill frontmatter fields', () => {
    const skill = generateSkillMarkdown({
      id: 'review-pr',
      type: 'skill',
      label: 'Review PR',
      description: 'Review a pull request.',
      argumentHint: '[pr-number]',
      userInvocable: false,
      disableModelInvocation: true,
      context: 'fork',
      procedure: ['Inspect diff.']
    });
    expect(skill).toContain('name: "review-pr"');
    expect(skill).toContain('description: "Review a pull request."');
    expect(skill).toContain('argument-hint: "[pr-number]"');
    expect(skill).toContain('user-invocable: false');
    expect(skill).toContain('disable-model-invocation: true');
    expect(skill).toContain('context: "fork"');
  });

  it('uses a node markdown override when edited from the webview', () => {
    const implementer = pipeline.nodes.find((node) => node.id === 'implementer' && node.type === 'agent');
    expect(implementer?.type).toBe('agent');
    expect(generateAgentMarkdown({ ...implementer!, markdown: '# Custom Agent\n\nEdited in Agent Flow.' })).toContain('<!-- Generated by Agent Flow');
    expect(generateAgentMarkdown({ ...implementer!, markdown: '# Custom Agent\n\nEdited in Agent Flow.' })).toContain('# Custom Agent');
  });

  it('updates generated frontmatter when config changes but preserves edited markdown body', () => {
    const agent = generateAgentMarkdown({
      id: 'reviewer',
      type: 'agent',
      label: 'Reviewer',
      description: 'Reviews changes.',
      tools: ['read', 'search'],
      calls: ['worker'],
      outputs: [],
      markdown: `---
name: "Old Reviewer"
tools:
  - "read"
---

# Custom Body

Keep this prose.`
    });

    expect(agent).toContain('name: "reviewer"');
    expect(agent).toContain('tools:\n  - "read"\n  - "search"');
    expect(agent).toContain('agents:\n  - "worker"');
    expect(agent).toContain('# Custom Body');
    expect(agent).toContain('Keep this prose.');
    expect(agent).not.toContain('Old Reviewer');
  });

  it('generates actionable artifact, instruction, and role references for agents', () => {
    const agent = generateAgentMarkdown({
      id: 'reviewer',
      type: 'agent',
      label: 'Reviewer',
      description: 'Reviews implementation.',
      tools: ['read'],
      inputs: ['.github/artifacts/implementation.md'],
      outputs: ['.github/artifacts/review.md'],
      artifactUsages: [
        { path: '.github/artifacts/implementation.md', action: 'read', instruction: 'Use $artifact as the source of truth for the review.' },
        { path: '.github/artifacts/review.md', action: 'write', instruction: 'Write blocking findings first.' }
      ],
      instructionRefs: [
        { target: '.github/instructions/docs-scope.instructions.md', instruction: 'Apply $instruction when reviewing documentation changes.' }
      ],
      roleRefs: [
        { target: '.github/roles/reviewer.md' }
      ]
    });

    expect(agent).toContain('# Artifact work');
    expect(agent).toContain('<!--agent-flow:begin artifact-ref action="read" path=".github/artifacts/implementation.md"-->');
    expect(agent).toContain('Use `.github/artifacts/implementation.md` as the source of truth for the review.');
    expect(agent).toContain('<!--agent-flow:begin artifact-ref action="write" path=".github/artifacts/review.md"-->');
    expect(agent).toContain('Write blocking findings first.');
    expect(agent).toContain('# Referenced instructions');
    expect(agent).toContain('<!--agent-flow:begin instruction-ref target=".github/instructions/docs-scope.instructions.md"-->');
    expect(agent).toContain('Apply `.github/instructions/docs-scope.instructions.md` when reviewing documentation changes.');
    expect(agent).toContain('# Referenced roles');
    expect(agent).toContain('<!--agent-flow:begin role-ref target=".github/roles/reviewer.md"-->');
  });

  it('parses magic reference blocks back into placeholder instructions', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agentflow-magic-refs-'));
    await fs.mkdir(path.join(workspace, '.github/agents'), { recursive: true });
    await fs.writeFile(path.join(workspace, '.github/agents/reviewer.agent.md'), `---
name: "Reviewer"
tools:
  - "read"
---

# Artifact work

<!--agent-flow:begin artifact-ref action="read" path=".github/artifacts/implementation.md"-->
Use \`.github/artifacts/implementation.md\` as the source of truth for the review.
<!--agent-flow:end artifact-ref-->

# Referenced instructions

<!--agent-flow:begin instruction-ref target=".github/instructions/docs-scope.instructions.md"-->
Apply \`.github/instructions/docs-scope.instructions.md\` when reviewing documentation changes.
<!--agent-flow:end instruction-ref-->

# Referenced roles

<!--agent-flow:begin role-ref target=".github/roles/reviewer.md"-->
Use \`.github/roles/reviewer.md\` for review tone.
<!--agent-flow:end role-ref-->
`, 'utf8');
    const pipeline = await inferPipelineFromWorkspace(workspace);
    const reviewer = pipeline.nodes.find((node) => node.id === 'reviewer');

    expect(reviewer?.type).toBe('agent');
    expect(reviewer).toMatchObject({
      inputs: ['.github/artifacts/implementation.md'],
      artifactUsages: [
        { path: '.github/artifacts/implementation.md', action: 'read', instruction: 'Use $artifact as the source of truth for the review.' }
      ],
      instructionRefs: [
        { target: '.github/instructions/docs-scope.instructions.md', instruction: 'Apply $instruction when reviewing documentation changes.' }
      ],
      roleRefs: [
        { target: '.github/roles/reviewer.md' }
      ]
    });
  });

  it('updates artifact work in edited agent markdown when config changes', () => {
    const agent = generateAgentMarkdown({
      id: 'writer',
      type: 'agent',
      label: 'Writer',
      tools: ['read'],
      outputs: ['.github/artifacts/summary.md'],
      artifactUsages: [
        { path: '.github/artifacts/summary.md', action: 'write', instruction: 'Create a summary with risks and next steps.' }
      ],
      markdown: `---
name: "Writer"
tools:
  - "read"
---

# Role

Keep this custom role text.

# Artifact work

None.

# Notes

Keep this custom note.`
    });

    expect(agent).toContain('# Role');
    expect(agent).toContain('Keep this custom role text.');
    expect(agent).toContain('# Artifact work');
    expect(agent).toContain('<!--agent-flow:begin artifact-ref action="write" path=".github/artifacts/summary.md"-->');
    expect(agent).toContain('Create a summary with risks and next steps.');
    expect(agent).toContain('# Notes');
    expect(agent).toContain('Keep this custom note.');
    expect(agent).not.toContain('# Artifact work\n\nNone.');
  });

  it('generates actionable artifact, instruction, and role references for prompts', () => {
    const prompt = generatePromptMarkdown({
      id: 'release-notes',
      type: 'prompt',
      label: 'Release Notes',
      description: 'Draft release notes.',
      requiredArtifacts: ['.github/artifacts/review.md'],
      artifactUsages: [
        { path: '.github/artifacts/review.md', action: 'read', instruction: 'Summarize only accepted findings.' }
      ],
      instructionRefs: [
        { target: '.github/instructions/docs-scope.instructions.md', instruction: 'Use the docs style rules.' }
      ],
      roleRefs: [
        { target: '.github/roles/release-writer.md' }
      ]
    });

    expect(prompt).toContain('# Required artifacts');
    expect(prompt).toContain('<!--agent-flow:begin artifact-ref action="read" path=".github/artifacts/review.md"-->');
    expect(prompt).toContain('Summarize only accepted findings.');
    expect(prompt).toContain('# Referenced instructions');
    expect(prompt).toContain('<!--agent-flow:begin instruction-ref target=".github/instructions/docs-scope.instructions.md"-->');
    expect(prompt).toContain('Use the docs style rules.');
    expect(prompt).toContain('# Referenced roles');
    expect(prompt).toContain('<!--agent-flow:begin role-ref target=".github/roles/release-writer.md"-->');
  });

  it('honors explicit file paths for newly inserted Markdown-backed nodes', () => {
    const files = generateFiles({
      version: 1,
      name: 'Inserted nodes',
      nodes: [
        { id: 'new-agent-1', type: 'agent', label: 'New agent', agentFile: '.github/agents/new-agent-1.agent.md', tools: [], calls: [], outputs: [] },
        { id: 'new-prompt-1', type: 'prompt', label: 'New prompt', promptFile: '.github/prompts/new-prompt-1.prompt.md', tools: [] },
        { id: 'new-instruction-1', type: 'instruction', label: 'New instruction', instructionFile: '.github/instructions/new-instruction-1.instructions.md', applyTo: undefined },
        { id: 'new-skill-1', type: 'skill', label: 'New skill', skillFile: '.github/skills/new-skill-1/SKILL.md' },
        { id: 'new-role-1', type: 'role', label: 'New role', roleFile: '.github/roles/new-role-1.md' },
        { id: 'new-artifact-1', type: 'artifact', label: 'New artifact', path: '.github/artifacts/new-artifact-1.md' },
        { id: 'new-gate-1', type: 'gate', label: 'New gate', condition: 'Define condition' },
        { id: 'new-handoff-1', type: 'handoff', label: 'New handoff' },
        { id: 'new-mcp-server-1', type: 'mcp-server', label: 'New MCP server' }
      ],
      edges: []
    }).map((file) => file.path);

    expect(files).toContain('.github/agents/new-agent-1.agent.md');
    expect(files).toContain('.github/prompts/new-prompt-1.prompt.md');
    expect(files).toContain('.github/instructions/new-instruction-1.instructions.md');
    expect(files).toContain('.github/skills/new-skill-1/SKILL.md');
    expect(files).toContain('.github/roles/new-role-1.md');
    expect(files).toContain('.github/artifacts/new-artifact-1.md');
    expect(files).not.toContain('.github/gates/new-gate-1.md');
    expect(files).not.toContain('.github/handoffs/new-handoff-1.md');
    expect(files).not.toContain('.github/mcp-servers/new-mcp-server-1.md');
  });

  it('uses a renamed new node label for generated markdown file names', () => {
    const files = generateFiles({
      version: 1,
      name: 'New nodes',
      nodes: [
        renameNodeLabel({ id: 'new-agent-1', type: 'agent', label: 'New agent', agentFile: '.github/agents/new-agent-1.agent.md', tools: [], calls: [], outputs: [] }, 'Security Reviewer'),
        renameNodeLabel({ id: 'new-prompt-1', type: 'prompt', label: 'New prompt', promptFile: '.github/prompts/new-prompt-1.prompt.md', tools: [] }, 'Release Notes'),
        renameNodeLabel({ id: 'new-instruction-1', type: 'instruction', label: 'New instruction', instructionFile: '.github/instructions/new-instruction-1.instructions.md', applyTo: '**/*.md' }, 'Docs Scope'),
        renameNodeLabel({ id: 'new-skill-1', type: 'skill', label: 'New skill', skillFile: '.github/skills/new-skill-1/SKILL.md' }, 'Review PR'),
        renameNodeLabel({ id: 'new-role-1', type: 'role', label: 'New role', roleFile: '.github/roles/new-role-1.md' }, 'Frontend Developer')
      ],
      edges: []
    }).map((file) => file.path);

    expect(files).toContain('.github/agents/security-reviewer.agent.md');
    expect(files).toContain('.github/prompts/release-notes.prompt.md');
    expect(files).toContain('.github/instructions/docs-scope.instructions.md');
    expect(files).toContain('.github/skills/review-pr/SKILL.md');
    expect(files).toContain('.github/roles/frontend-developer.md');
  });

  it('uses renamed new node labels in generated markdown content', () => {
    const files = generateFiles({
      version: 1,
      name: 'New node content',
      nodes: [
        renameNodeLabel({ id: 'new-agent-1', type: 'agent', label: 'New agent', agentFile: '.github/agents/new-agent-1.agent.md', tools: [], calls: [], outputs: [] }, 'Security Reviewer'),
        renameNodeLabel({ id: 'new-prompt-1', type: 'prompt', label: 'New prompt', promptFile: '.github/prompts/new-prompt-1.prompt.md', tools: [] }, 'Release Notes'),
        renameNodeLabel({ id: 'new-instruction-1', type: 'instruction', label: 'New instruction', instructionFile: '.github/instructions/new-instruction-1.instructions.md', applyTo: '**/*.md' }, 'Docs Scope'),
        renameNodeLabel({ id: 'new-skill-1', type: 'skill', label: 'New skill', skillFile: '.github/skills/new-skill-1/SKILL.md' }, 'Review PR'),
        renameNodeLabel({ id: 'new-role-1', type: 'role', label: 'New role', roleFile: '.github/roles/new-role-1.md' }, 'Frontend Developer')
      ],
      edges: []
    });

    expect(files.find((file) => file.path === '.github/agents/security-reviewer.agent.md')?.content).toContain('name: "security reviewer"');
    expect(files.find((file) => file.path === '.github/prompts/release-notes.prompt.md')?.content).toContain('# release notes');
    expect(files.find((file) => file.path === '.github/instructions/docs-scope.instructions.md')?.content).toContain('# docs scope');
    expect(files.find((file) => file.path === '.github/skills/review-pr/SKILL.md')?.content).toContain('name: "review-pr"');
    expect(files.find((file) => file.path === '.github/skills/review-pr/SKILL.md')?.content).toContain('# review pr');
    expect(files.find((file) => file.path === '.github/roles/frontend-developer.md')?.content).toContain('name: "frontend developer"');
  });

  it('generates all files in deterministic path order', () => {
    const files = generateFiles(pipeline);
    expect(files.map((file) => file.path)).toEqual([...files.map((file) => file.path)].sort());
    expect(files.some((file) => file.path === 'AGENT_PIPELINE.md')).toBe(false);
  });
});

describe('webview graph projection', () => {
  it('coerces and applies flow layout settings', () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Layouts',
      nodes: [
        { id: 'prompt', type: 'prompt', label: 'Prompt', startAgent: 'agent', position: { x: 11, y: 22 } },
        { id: 'agent', type: 'agent', label: 'Agent', calls: ['skill'], outputs: [] },
        { id: 'skill', type: 'skill', label: 'Skill' }
      ],
      edges: []
    };

    expect(coerceFlowLayout('vertical')).toBe('vertical');
    expect(coerceFlowLayout('compact')).toBe('compact');
    expect(coerceFlowLayout('manual')).toBe('compact');
    expect(coerceFlowLayout('unknown')).toBe('compact');
    expect(layoutFlowNodes(pipeline, 'vertical').get('agent')?.y).toBeGreaterThan(layoutFlowNodes(pipeline, 'vertical').get('prompt')?.y ?? 0);
    expect(layoutFlowNodes(pipeline, 'horizontal').get('agent')?.x).toBeGreaterThan(layoutFlowNodes(pipeline, 'horizontal').get('prompt')?.x ?? 0);
    expect(layoutFlowNodes(pipeline, 'typeColumns').get('agent')?.x).toBeGreaterThan(layoutFlowNodes(pipeline, 'typeColumns').get('prompt')?.x ?? 0);
    expect(layoutFlowNodes(pipeline, 'compact').size).toBe(3);
    expect(flowLayoutLane('prompt')).toBe('entry');
    expect(flowLayoutLane('agent')).toBe('workflow');
    expect(flowLayoutLane('gate')).toBe('control');
    expect(flowLayoutLane('artifact')).toBe('artifact');
    expect(flowLayoutLane('instruction')).toBe('context');
  });

  it('places large compact layouts without node collisions', () => {
    const nodes: AgentPipeline['nodes'] = Array.from({ length: 30 }, (_, index) => ({
      id: `node-${index}`,
      type: index % 3 === 0 ? 'agent' : index % 3 === 1 ? 'prompt' : 'instruction',
      label: `Node ${index}`
    } as AgentPipeline['nodes'][number]));
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Large layout',
      nodes,
      edges: nodes.slice(1).map((node, index) => ({ id: `edge-${index}`, from: nodes[index].id, to: node.id, kind: 'flow' }))
    };

    const positions = [...layoutFlowNodes(pipeline, 'compact').values()];
    const occupied = new Set(positions.map((position) => `${position.x}:${position.y}`));

    expect(positions).toHaveLength(nodes.length);
    expect(occupied.size).toBe(nodes.length);
    expect(Math.max(...positions.map((position) => position.y))).toBeLessThan(150 * 6);
  });

  it('keeps long directed compact layouts in a readable left-to-right flow', () => {
    const nodes: AgentPipeline['nodes'] = Array.from({ length: 18 }, (_, index) => {
      if (index % 2 === 1) {
        return {
          id: `step-${index}`,
          type: 'artifact',
          label: `Step ${index}`,
          path: `.github/artifacts/step-${index}.md`
        } as AgentPipeline['nodes'][number];
      }
      return {
        id: `step-${index}`,
        type: 'agent',
        label: `Step ${index}`,
        inputs: index > 0 ? [`.github/artifacts/step-${index - 1}.md`] : [],
        outputs: index < 17 ? [`.github/artifacts/step-${index + 1}.md`] : []
      } as AgentPipeline['nodes'][number];
    });
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Long flow',
      nodes,
      edges: []
    };

    const positions = layoutFlowNodes(pipeline, 'compact');
    const maxX = Math.max(...[...positions.values()].map((position) => position.x));
    const maxY = Math.max(...[...positions.values()].map((position) => position.y));

    expect(maxX).toBeGreaterThan(285 * 8);
    expect(maxY).toBeLessThanOrEqual(150 * 4);
    expect((positions.get('step-9')?.x ?? 0)).toBeGreaterThan(positions.get('step-7')?.x ?? 0);
    expect((positions.get('step-1')?.y ?? 0)).toBeGreaterThan(positions.get('step-0')?.y ?? 0);
  });

  it('keeps the default compact layout bounded and collision-free', () => {
    const pipeline = createDefaultPipeline();
    const positions = layoutFlowNodes(pipeline, 'compact');
    const occupied = new Set([...positions.values()].map((position) => `${position.x}:${position.y}`));
    const xs = [...positions.values()].map((position) => position.x);
    const ys = [...positions.values()].map((position) => position.y);

    expect(positions.size).toBe(pipeline.nodes.length);
    expect(occupied.size).toBe(pipeline.nodes.length);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(285 * 3);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(150 * 8);
    const prompt = pipeline.nodes.find((node) => node.type === 'prompt');
    const firstAgent = pipeline.nodes.find((node) => node.type === 'agent');
    const firstArtifact = pipeline.nodes.find((node) => node.type === 'artifact');
    expect(positions.get(firstAgent?.id ?? '')?.y).toBeGreaterThan(positions.get(prompt?.id ?? '')?.y ?? 0);
    expect(positions.get(firstArtifact?.id ?? '')?.y).toBeGreaterThan(positions.get(firstAgent?.id ?? '')?.y ?? 0);
    for (const edge of deriveVisibleFlowEdges(pipeline).filter((edge) => edge.data.derivedFrom.includes('artifact'))) {
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);
      expect(source).toBeDefined();
      expect(target).toBeDefined();
      expect(Math.abs((source?.x ?? 0) - (target?.x ?? 0))).toBeLessThanOrEqual(285 * 3);
    }
  });

  it('estimates token badges for generated node content', () => {
    const pipeline = createDefaultPipeline();
    const implementer = pipeline.nodes.find((node) => node.id === 'implementer');
    expect(implementer).toBeDefined();
    expect(estimateTokenCount('')).toBe(0);
    expect(estimateTokenCount('123456789')).toBe(3);
    expect(estimateNodeTokenCount(pipeline, implementer!)).toBeGreaterThan(50);
    expect(formatTokenBadge(999)).toBe('~999 tok');
    expect(formatTokenBadge(1200)).toBe('~1.2k tok');
  });

  it('projects live configuration references into visible flow edges', () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Live refs',
      nodes: [
        { id: 'prompt', type: 'prompt', label: 'Prompt', startAgent: 'Router' },
        { id: 'router', type: 'agent', label: 'Router', calls: ['"Worker Agent"'], outputs: ['.github/artifacts/work.md'] },
        { id: 'worker-agent', type: 'agent', label: 'Worker Agent', inputs: ['.github/artifacts/work.md'] },
        { id: 'work-artifact', type: 'artifact', label: 'Work artifact', path: '.github/artifacts/work.md' }
      ],
      edges: []
    };

    expect(deriveVisibleFlowEdges(pipeline).map((edge) => [edge.id, edge.source, edge.target, edge.data?.derivedFrom])).toEqual([
      ['ref:prompt:prompt:startAgent:router', 'prompt', 'router', 'prompt.startAgent'],
      ['ref:agent:router:calls:worker-agent', 'router', 'worker-agent', 'agent.calls'],
      ['ref:artifact-output:router:work-artifact', 'router', 'work-artifact', 'agent.outputs'],
      ['ref:artifact-input:work-artifact:worker-agent', 'work-artifact', 'worker-agent', 'agent.inputs']
    ]);
  });

  it('projects handoffs as distinct visible edges', () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Handoffs',
      nodes: [
        { id: 'router', type: 'agent', label: 'Router', calls: [], outputs: [], handoffs: [{ label: 'Escalate', agent: 'worker', prompt: 'Take over.' }] },
        { id: 'worker', type: 'agent', label: 'Worker', outputs: [] }
      ],
      edges: []
    };

    expect(deriveVisibleFlowEdges(pipeline).map((edge) => [edge.source, edge.target, edge.label, edge.data.kind, edge.data.derivedFrom, edge.style?.strokeDasharray])).toEqual([
      ['router', 'worker', 'Escalate', 'handoff', 'agent.handoffs', '3 3']
    ]);
  });

  it('projects handoff nodes to their target agents', () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Handoff node',
      nodes: [
        { id: 'router', type: 'agent', label: 'Router', calls: [], outputs: [] },
        { id: 'handoff', type: 'handoff', label: 'Escalate', sourceAgent: 'router', targetAgent: 'worker' },
        { id: 'worker', type: 'agent', label: 'Worker', outputs: [] }
      ],
      edges: [
        { id: 'router-handoff-node-handoff', from: 'router', to: 'handoff', kind: 'handoff', label: 'Escalate' },
        { id: 'handoff-handoff-target-worker', from: 'handoff', to: 'worker', kind: 'handoff', label: 'Escalate' }
      ]
    };

    expect(deriveVisibleFlowEdges(pipeline).map((edge) => [edge.id, edge.source, edge.target, edge.label, edge.data.derivedFrom])).toEqual([
      ['router-handoff-node-handoff', 'router', 'handoff', 'Escalate', 'pipeline.edges'],
      ['handoff-handoff-target-worker', 'handoff', 'worker', 'Escalate', 'pipeline.edges']
    ]);
  });

  it('keeps materialized handoff nodes connected to their target agent when inferred from agent handoffs', () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Materialized handoff',
      nodes: [
        { id: 'riker', type: 'agent', label: 'riker', calls: [], outputs: [], handoffs: [{ label: 'Architecture', agent: 'bob', prompt: 'Review architecture.' }] },
        { id: 'riker-handoff-architecture', type: 'handoff', label: 'Architecture', sourceAgent: 'riker', targetAgent: 'bob', prompt: 'Review architecture.' },
        { id: 'bob', type: 'agent', label: 'bob', outputs: [] }
      ],
      edges: [
        { id: 'riker-handoff-node-riker-handoff-architecture', from: 'riker', to: 'riker-handoff-architecture', kind: 'handoff', label: 'Architecture' }
      ]
    };

    expect(deriveVisibleFlowEdges(pipeline).map((edge) => [edge.source, edge.target, edge.label, edge.data.derivedFrom])).toEqual([
      ['riker', 'riker-handoff-architecture', 'Architecture', 'pipeline.edges'],
      ['riker-handoff-architecture', 'bob', 'Architecture', 'handoff.targetAgent']
    ]);
  });

  it('projects live handoff node target references and edge direction markers', () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Live handoff node',
      nodes: [
        { id: 'handoff', type: 'handoff', label: 'Escalate', targetAgent: 'worker' },
        { id: 'worker', type: 'agent', label: 'Worker', outputs: [] }
      ],
      edges: []
    };

    expect(deriveVisibleFlowEdges(pipeline).map((edge) => [edge.source, edge.target, edge.label, edge.data.derivedFrom, edge.markerEnd && typeof edge.markerEnd === 'object' ? edge.markerEnd.type : undefined])).toEqual([
      ['handoff', 'worker', 'Escalate', 'handoff.targetAgent', 'arrowclosed']
    ]);
  });

  it('projects prompt artifact usage and instruction references into visible edges', () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Reference edges',
      nodes: [
        { id: 'prompt', type: 'prompt', label: 'Prompt', artifactUsages: [{ path: '.github/artifacts/brief.md', action: 'read', instruction: 'Summarize it.' }], instructionRefs: [{ target: '.github/instructions/docs.instructions.md', instruction: 'Use docs rules.' }] },
        { id: 'artifact', type: 'artifact', label: 'Brief', path: '.github/artifacts/brief.md' },
        { id: 'docs', type: 'instruction', label: 'Docs', instructionFile: '.github/instructions/docs.instructions.md', applyTo: 'docs/**/*.md' }
      ],
      edges: []
    };

    expect(deriveVisibleFlowEdges(pipeline).map((edge) => [edge.source, edge.target, edge.label, edge.data.derivedFrom, edge.data.kind, edge.markerEnd?.color])).toEqual([
      ['artifact', 'prompt', 'reads', 'prompt.artifactUsages', 'reference', 'var(--vscode-charts-green)'],
      ['docs', 'prompt', 'instructs', 'prompt.instructionRefs', 'reference', 'var(--vscode-charts-orange)']
    ]);
  });

  it('keeps reference edges static until live activity marks them active', () => {
    const animatedEdges = deriveVisibleFlowEdges(createDefaultPipeline()).filter((edge) => edge.animated);

    expect(animatedEdges).toEqual([]);
  });

  it('does not project wildcard instruction references back to the same instruction node', () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Self instruction refs',
      nodes: [
        { id: 'frontend', type: 'instruction', label: 'Frontend', instructionFile: '.github/instructions/frontend.instructions.md', instructionRefs: [{ target: '.github/instructions/*.instructions.md' }] },
        { id: 'shared', type: 'instruction', label: 'Shared', instructionFile: '.github/instructions/shared.instructions.md' }
      ],
      edges: []
    };

    expect(deriveVisibleFlowEdges(pipeline).map((edge) => [edge.source, edge.target, edge.label])).toEqual([
      ['shared', 'frontend', 'instructs']
    ]);
  });


  it('projects instruction file references into visible edges', () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Instruction refs',
      nodes: [
        { id: 'atom', type: 'instruction', label: 'Atom', instructionFile: '.github/instructions/atom.instructions.md', applyTo: '!**/*', instructionRefs: [{ target: '.github/instructions/template.instructions.md' }] },
        { id: 'template', type: 'instruction', label: 'Template', instructionFile: '.github/instructions/template.instructions.md', applyTo: '**/*' }
      ],
      edges: []
    };

    expect(deriveVisibleFlowEdges(pipeline).map((edge) => [edge.source, edge.target, edge.label, edge.data.derivedFrom, edge.data.kind])).toEqual([
      ['template', 'atom', 'instructs', 'instruction.instructionRefs', 'reference']
    ]);
  });

  it('projects role file references into visible edges', () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Role refs',
      nodes: [
        {
          id: 'frontend',
          type: 'agent',
          label: 'Frontend',
          outputs: [],
          roleRefs: [{ target: '.github/roles/frontend-developer.md' }]
        },
        {
          id: 'frontend-developer',
          type: 'role',
          label: 'Frontend Developer',
          roleFile: '.github/roles/frontend-developer.md'
        }
      ],
      edges: []
    };

    expect(deriveVisibleFlowEdges(pipeline).map((edge) => [edge.source, edge.target, edge.label, edge.data.derivedFrom, edge.data.kind])).toEqual([
      ['frontend-developer', 'frontend', 'role', 'agent.roleRefs', 'reference']
    ]);
  });

  it('keeps explicit user-drawn edges editable and avoids duplicate reference previews', () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Explicit refs',
      nodes: [
        { id: 'router', type: 'agent', label: 'Router', calls: ['worker'], outputs: [] },
        { id: 'worker', type: 'agent', label: 'Worker', outputs: [] }
      ],
      edges: [{ id: 'router-to-worker', from: 'router', to: 'worker', kind: 'flow', label: 'handoff' }]
    };

    expect(deriveVisibleFlowEdges(pipeline).map((edge) => [edge.id, edge.source, edge.target, edge.data?.derivedFrom])).toEqual([
      ['router-to-worker', 'router', 'worker', 'pipeline.edges']
    ]);
  });

  it('keeps generic stored flow edges visible even without a live reference', () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Manual flow',
      nodes: [
        { id: 'router', type: 'agent', label: 'Router', calls: [], outputs: [] },
        { id: 'worker', type: 'agent', label: 'Worker', outputs: [] }
      ],
      edges: [{ id: 'manual-flow', from: 'router', to: 'worker', kind: 'flow' }]
    };

    expect(deriveVisibleFlowEdges(pipeline).map((edge) => [edge.id, edge.source, edge.target, edge.label])).toEqual([
      ['manual-flow', 'router', 'worker', undefined]
    ]);
  });

  it('does not render generic flow labels and keeps meaningful edge labels', () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Edge labels',
      nodes: [
        { id: 'router', type: 'agent', label: 'Router', calls: ['worker'], outputs: ['.github/artifacts/result.md'] },
        { id: 'worker', type: 'agent', label: 'Worker', outputs: [] },
        { id: 'artifact', type: 'artifact', label: 'Result', path: '.github/artifacts/result.md' },
        { id: 'gate', type: 'gate', label: 'Ready?', condition: 'Tests passed' }
      ],
      edges: [
        { id: 'router-to-worker', from: 'router', to: 'worker', kind: 'flow' },
        { id: 'router-to-artifact', from: 'router', to: 'artifact', kind: 'artifact', artifact: '.github/artifacts/result.md' },
        { id: 'worker-to-gate', from: 'worker', to: 'gate', kind: 'gate', label: 'true' },
        { id: 'gate-to-router', from: 'gate', to: 'router', kind: 'flow', label: 'retry' }
      ]
    };

    expect(deriveVisibleFlowEdges(pipeline).map((edge) => [edge.id, edge.label])).toEqual([
      ['router-to-worker', undefined],
      ['router-to-artifact', '.github/artifacts/result.md'],
      ['worker-to-gate', 'true'],
      ['gate-to-router', 'retry']
    ]);
  });

  it('renders gate branch metadata as visible true, false, and error edges', () => {
    const pipeline: AgentPipeline = {
      name: 'gates',
      nodes: [
        { id: 'gate', type: 'gate', label: 'quality gate', condition: 'tests passed', trueBranch: 'ship', falseBranch: 'fix', errorBranch: 'fallback' },
        { id: 'ship', type: 'agent', label: 'ship' },
        { id: 'fix', type: 'agent', label: 'fix' },
        { id: 'fallback', type: 'agent', label: 'fallback' }
      ],
      edges: []
    };

    expect(deriveVisibleFlowEdges(pipeline).map((edge) => [edge.source, edge.target, edge.label, edge.data.derivedFrom, edge.data.kind])).toEqual([
      ['gate', 'ship', 'true', 'gate.trueBranch', 'gate'],
      ['gate', 'fix', 'false', 'gate.falseBranch', 'gate'],
      ['gate', 'fallback', 'error', 'gate.errorBranch', 'error']
    ]);
  });

  it('hides stored handoff edges when the handoff reference is removed', () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Unchecked refs',
      nodes: [
        { id: 'router', type: 'agent', label: 'Router', calls: [], outputs: [] },
        { id: 'worker', type: 'agent', label: 'Worker', outputs: [] }
      ],
      edges: [{ id: 'router-to-worker', from: 'router', to: 'worker', kind: 'handoff' }]
    };

    expect(deriveVisibleFlowEdges(pipeline)).toEqual([]);
  });

  it('hides stored prompt edges when the start agent reference is removed', () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Prompt refs',
      nodes: [
        { id: 'prompt', type: 'prompt', label: 'Prompt' },
        { id: 'router', type: 'agent', label: 'Router', outputs: [] }
      ],
      edges: [{ id: 'prompt-to-router', from: 'prompt', to: 'router', kind: 'prompt' }]
    };

    expect(deriveVisibleFlowEdges(pipeline)).toEqual([]);
  });

  it('hides stored artifact-node edges when input or output references are removed', () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Artifact refs',
      nodes: [
        { id: 'producer', type: 'agent', label: 'Producer', outputs: [] },
        { id: 'artifact', type: 'artifact', label: 'Artifact', path: '.github/artifacts/result.md' },
        { id: 'consumer', type: 'agent', label: 'Consumer', inputs: [], outputs: [] }
      ],
      edges: [
        { id: 'producer-to-artifact', from: 'producer', to: 'artifact', kind: 'artifact', artifact: '.github/artifacts/result.md' },
        { id: 'artifact-to-consumer', from: 'artifact', to: 'consumer', kind: 'artifact', artifact: '.github/artifacts/result.md' }
      ]
    };

    expect(deriveVisibleFlowEdges(pipeline)).toEqual([]);
  });
});

describe('agent reference normalization', () => {
  it('strips YAML quotes and resolves display-name references to agent ids', () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Quoted calls',
      nodes: [
        { id: 'alice-jira-ticket-formatter', type: 'agent', label: 'Alice (Jira Ticket Formatter)', calls: ['"Riker (Project Manager)"'] },
        { id: 'riker-project-manager', type: 'agent', label: 'Riker (Project Manager)' }
      ],
      edges: [{ id: 'alice-to-riker', from: 'alice-jira-ticket-formatter', to: '"Riker (Project Manager)"', kind: 'flow' }]
    };
    expect(stripYamlQuotes('"Riker (Project Manager)"')).toBe('Riker (Project Manager)');
    expect(resolveAgentReference('"Riker (Project Manager)"', pipeline.nodes)).toBe('riker-project-manager');
    const normalized = normalizePipelineAgentReferences(pipeline);
    expect(normalized.nodes[0].type === 'agent' && normalized.nodes[0].calls).toEqual(['riker-project-manager']);
    expect(normalized.edges[0].to).toBe('riker-project-manager');
  });
});

describe('validation rules', () => {
  it('does not report quoted display-name subagent references as unknown', () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Quoted calls',
      nodes: [
        { id: 'alice-jira-ticket-formatter', type: 'agent', label: 'Alice (Jira Ticket Formatter)', calls: ['"Riker (Project Manager)"'], outputs: ['.github/artifacts/alice.md'] },
        { id: 'riker-project-manager', type: 'agent', label: 'Riker (Project Manager)', outputs: ['.github/artifacts/riker.md'] }
      ],
      edges: [{ id: 'alice-to-riker', from: 'alice-jira-ticket-formatter', to: '"Riker (Project Manager)"', kind: 'flow' }]
    };
    const ids = validatePipeline(pipeline).map((finding) => finding.ruleId);
    expect(ids).not.toContain('unknown-subagent');
    expect(ids).not.toContain('unknown-edge-to');
  });

  it('detects unknown subagents, unknown prompt agents, broad applyTo, and risky tools', () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Risky',
      nodes: [
        { id: 'a', type: 'agent', label: 'A', tools: ['edit', 'execute'], calls: ['missing'], outputs: [] },
        { id: 'p', type: 'prompt', label: 'P', startAgent: 'missing-agent' },
        { id: 'i', type: 'instruction', label: 'I', applyTo: '**/*' },
        { id: 's', type: 'skill', label: 'S', description: 'general' }
      ],
      edges: []
    };
    const ids = validatePipeline(pipeline).map((finding) => finding.ruleId);
    expect(ids).toContain('unknown-subagent');
    expect(ids).toContain('prompt-unknown-agent');
    expect(ids).toContain('broad-apply-to');
    expect(ids).toContain('broad-agent-tools');
    expect(ids).toContain('missing-command-safety');
    expect(ids).toContain('generic-skill-description');
  });

  it('allows bounded default test/fix cycle via gate max iterations', () => {
    const ids = validatePipeline(createDefaultPipeline()).map((finding) => finding.ruleId);
    expect(ids).not.toContain('unbounded-cycle');
  });
});

describe('risk score', () => {
  it('scores context risk reasons', () => {
    const risk = calculateRiskScore(createDefaultPipeline(), { copilotInstructionsLines: 280 });
    expect(risk.score).toBeGreaterThan(0);
    expect(risk.reasons.join('\n')).toContain('copilot-instructions.md has 280 lines');
  });
});
