import { describe, expect, it } from 'vitest';
import { generateAgentMarkdown, generatePromptMarkdown } from '../src/pipeline/generators';
import { AgentPipeline } from '../src/pipeline/types';
import { applyConnectionIntent, buildConnectionIntentOptions, connectPipelineNodes, deletePipelineEdges, deletePipelineNodes, deriveRenamePreview, renameNodeLabel, renamePipelineNodeLabel } from '../src/webview/flowMutations';
import { deriveVisibleFlowEdges } from '../src/webview/graph';

function basePipeline(): AgentPipeline {
  return {
    version: 1,
    name: 'Mutable flow',
    nodes: [
      { id: 'start', type: 'prompt', label: 'Start', tools: [] },
      { id: 'router', type: 'agent', label: 'Router', calls: [], inputs: [], outputs: [] },
      { id: 'worker', type: 'agent', label: 'Worker', calls: [], inputs: [], outputs: [] },
      { id: 'artifact', type: 'artifact', label: 'Result', path: '.github/artifacts/result.md' }
    ],
    edges: []
  };
}

describe('flow mutations', () => {
  it('syncs an agent-to-agent canvas connection into agent calls', () => {
    const next = connectPipelineNodes(basePipeline(), 'router', 'worker');
    const router = next.nodes.find((node) => node.id === 'router' && node.type === 'agent');

    expect(router?.type).toBe('agent');
    expect(router?.calls).toEqual(['worker']);
    expect(next.edges).toEqual([{ id: 'router-flow-worker', from: 'router', to: 'worker', kind: 'flow', artifact: undefined }]);
  });

  it('syncs a prompt-to-agent canvas connection into the prompt start agent', () => {
    const next = connectPipelineNodes(basePipeline(), 'start', 'router');
    const start = next.nodes.find((node) => node.id === 'start' && node.type === 'prompt');

    expect(start?.type).toBe('prompt');
    expect(start?.startAgent).toBe('router');
    expect(next.edges).toEqual([{ id: 'start-prompt-router', from: 'start', to: 'router', kind: 'prompt', artifact: undefined }]);
  });

  it('syncs artifact connections into producer outputs and consumer inputs', () => {
    const produced = connectPipelineNodes(basePipeline(), 'router', 'artifact');
    const consumed = connectPipelineNodes(produced, 'artifact', 'worker');
    const router = consumed.nodes.find((node) => node.id === 'router' && node.type === 'agent');
    const worker = consumed.nodes.find((node) => node.id === 'worker' && node.type === 'agent');

    expect(router?.type).toBe('agent');
    expect(worker?.type).toBe('agent');
    expect(router?.outputs).toEqual(['.github/artifacts/result.md']);
    expect(router?.artifactUsages).toEqual([{ path: '.github/artifacts/result.md', action: 'write' }]);
    expect(worker?.inputs).toEqual(['.github/artifacts/result.md']);
    expect(worker?.artifactUsages).toEqual([{ path: '.github/artifacts/result.md', action: 'read' }]);
    expect(consumed.edges.map((edge) => [edge.id, edge.from, edge.to, edge.kind, edge.artifact])).toEqual([
      ['router-artifact-artifact', 'router', 'artifact', 'artifact', '.github/artifacts/result.md'],
      ['artifact-artifact-worker', 'artifact', 'worker', 'artifact', '.github/artifacts/result.md']
    ]);
  });

  it('syncs prompt artifact connections into required artifacts', () => {
    const next = connectPipelineNodes(basePipeline(), 'start', 'artifact');
    const prompt = next.nodes.find((node) => node.id === 'start' && node.type === 'prompt');

    expect(prompt?.type).toBe('prompt');
    expect(prompt?.requiredArtifacts).toEqual(['.github/artifacts/result.md']);
    expect(prompt?.artifactUsages).toEqual([{ path: '.github/artifacts/result.md', action: 'read' }]);
  });

  it('offers explicit guided connection intents with markdown write previews', () => {
    const pipeline: AgentPipeline = {
      ...basePipeline(),
      nodes: [
        ...basePipeline().nodes,
        { id: 'docs', type: 'instruction', label: 'Docs', instructionFile: '.github/instructions/docs.instructions.md', applyTo: '**/*.md' },
        { id: 'role', type: 'role', label: 'Frontend Role', roleFile: '.github/roles/frontend.md' },
        { id: 'gate', type: 'gate', label: 'Quality Gate', condition: 'Tests pass' }
      ]
    };

    expect(buildConnectionIntentOptions(pipeline, 'router', 'artifact').filter((option) => option.enabled).map((option) => [option.kind, option.preview.field, option.preview.placeholder])).toEqual([
      ['artifact-write', 'Artifact work', '$artifact'],
      ['artifact-read', 'Artifact work', '$artifact'],
      ['artifact-append', 'Artifact work', '$artifact'],
      ['artifact-validate', 'Artifact work', '$artifact']
    ]);
    expect(buildConnectionIntentOptions(pipeline, 'router', 'worker').filter((option) => option.enabled).map((option) => option.kind)).toEqual(['handoff', 'subagent']);
    expect(buildConnectionIntentOptions(pipeline, 'router', 'docs').filter((option) => option.enabled).map((option) => [option.kind, option.preview.field, option.preview.placeholder])).toEqual([
      ['instruction-ref', 'Referenced instructions', '$instruction']
    ]);
    expect(buildConnectionIntentOptions(pipeline, 'router', 'role').filter((option) => option.enabled).map((option) => [option.kind, option.preview.field, option.preview.placeholder])).toEqual([
      ['role-ref', 'Referenced roles', '$role']
    ]);
    expect(buildConnectionIntentOptions(pipeline, 'gate', 'worker').filter((option) => option.enabled).map((option) => option.kind)).toEqual(['gate-true', 'gate-false', 'gate-error']);
  });

  it('applies guided connection intents without ambiguous fallback edges', () => {
    const pipeline: AgentPipeline = {
      ...basePipeline(),
      nodes: [
        ...basePipeline().nodes,
        { id: 'docs', type: 'instruction', label: 'Docs', instructionFile: '.github/instructions/docs.instructions.md', applyTo: '**/*.md' },
        { id: 'role', type: 'role', label: 'Frontend Role', roleFile: '.github/roles/frontend.md' },
        { id: 'gate', type: 'gate', label: 'Quality Gate', condition: 'Tests pass' }
      ]
    };

    const withOutput = applyConnectionIntent(pipeline, 'router', 'artifact', 'artifact-write');
    const routerWithOutput = withOutput.nodes.find((node) => node.id === 'router' && node.type === 'agent');
    expect(routerWithOutput?.outputs).toEqual(['.github/artifacts/result.md']);
    expect(routerWithOutput?.artifactUsages).toEqual([{ path: '.github/artifacts/result.md', action: 'write', instruction: 'Write $artifact.' }]);

    const withInput = applyConnectionIntent(withOutput, 'artifact', 'worker', 'artifact-read');
    const worker = withInput.nodes.find((node) => node.id === 'worker' && node.type === 'agent');
    expect(worker?.inputs).toEqual(['.github/artifacts/result.md']);
    expect(worker?.artifactUsages).toEqual([{ path: '.github/artifacts/result.md', action: 'read', instruction: 'Read $artifact.' }]);

    const withInstruction = applyConnectionIntent(withInput, 'router', 'docs', 'instruction-ref');
    const routerWithInstruction = withInstruction.nodes.find((node) => node.id === 'router' && node.type === 'agent');
    expect(routerWithInstruction?.instructionRefs).toEqual([{ target: '.github/instructions/docs.instructions.md', instruction: 'Use $instruction.' }]);

    const withRole = applyConnectionIntent(withInstruction, 'router', 'role', 'role-ref');
    const routerWithRole = withRole.nodes.find((node) => node.id === 'router' && node.type === 'agent');
    expect(routerWithRole?.roleRefs).toEqual([{ target: '.github/roles/frontend.md' }]);

    const withHandoff = applyConnectionIntent(withRole, 'router', 'worker', 'handoff');
    const routerWithHandoff = withHandoff.nodes.find((node) => node.id === 'router' && node.type === 'agent');
    expect(routerWithHandoff?.calls).toEqual([]);
    expect(routerWithHandoff?.handoffs).toEqual([{ label: 'hand off to worker', agent: 'worker', send: false }]);
    expect(withHandoff.edges).toContainEqual({ id: 'router-handoff-worker', from: 'router', to: 'worker', kind: 'handoff', label: 'hand off to worker' });

    const withGate = applyConnectionIntent(withHandoff, 'gate', 'worker', 'gate-true');
    const gate = withGate.nodes.find((node) => node.id === 'gate' && node.type === 'gate');
    expect(gate?.trueBranch).toBe('worker');
    expect(withGate.edges).not.toContainEqual(expect.objectContaining({ kind: 'flow', from: 'gate', to: 'worker' }));
  });

  it('syncs node label changes into managed file names', () => {
    expect(renameNodeLabel({ id: 'new-agent-1', type: 'agent', label: 'new agent', agentFile: '.github/agents/new-agent-1.agent.md', tools: [], calls: [], outputs: [] }, 'Security Reviewer')).toMatchObject({ label: 'security reviewer', agentFile: '.github/agents/security-reviewer.agent.md' });
    expect(renameNodeLabel({ id: 'new-prompt-1', type: 'prompt', label: 'new prompt', promptFile: '.github/prompts/new-prompt-1.prompt.md', tools: [] }, 'Release Notes')).toMatchObject({ label: 'release notes', promptFile: '.github/prompts/release-notes.prompt.md' });
    expect(renameNodeLabel({ id: 'new-instruction-1', type: 'instruction', label: 'new instruction', instructionFile: '.github/instructions/new-instruction-1.instructions.md', applyTo: '**/*' }, 'Docs Scope')).toMatchObject({ label: 'docs scope', instructionFile: '.github/instructions/docs-scope.instructions.md' });
    expect(renameNodeLabel({ id: 'new-skill-1', type: 'skill', label: 'new skill', skillFile: '.github/skills/new-skill-1/SKILL.md' }, 'Review PR')).toMatchObject({ label: 'review pr', skillFile: '.github/skills/review-pr/SKILL.md' });
    expect(renameNodeLabel({ id: 'new-artifact-1', type: 'artifact', label: 'new artifact', path: '.github/artifacts/new-artifact-1.md' }, 'Review Result')).toMatchObject({ label: 'review result', path: '.github/artifacts/review-result.md' });
  });

  it('keeps manually customized file paths when renaming nodes', () => {
    expect(renameNodeLabel({ id: 'router', type: 'agent', label: 'router', agentFile: 'custom/router.md', tools: [], calls: [], outputs: [] }, 'Security Reviewer')).toMatchObject({ label: 'security reviewer', agentFile: 'custom/router.md' });
    expect(renameNodeLabel({ id: 'artifact', type: 'artifact', label: 'artifact', path: 'reports/result.md' }, 'Review Result')).toMatchObject({ label: 'review result', path: 'reports/result.md' });
  });

  it('syncs agent renames into all referencing agent fields and generated markdown', () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Rename references',
      nodes: [
        { id: 'router', type: 'agent', label: 'router', agentFile: '.github/agents/router.agent.md', calls: ['Worker Agent', '.github/agents/worker-agent.agent.md'], outputs: [], handoffs: [{ label: 'Review', agent: '.github/agents/worker-agent.agent.md', send: false }] },
        { id: 'prompt', type: 'prompt', label: 'prompt', promptFile: '.github/prompts/prompt.prompt.md', startAgent: '.github/agents/worker-agent.agent.md' },
        { id: 'handoff', type: 'handoff', label: 'Review', targetAgent: '.github/agents/worker-agent.agent.md' },
        { id: 'worker-agent', type: 'agent', label: 'Worker Agent', agentFile: '.github/agents/worker-agent.agent.md', calls: [], outputs: [] }
      ],
      edges: []
    };

    const next = renamePipelineNodeLabel(pipeline, 'worker-agent', 'qa reviewer');
    const router = next.nodes.find((node) => node.id === 'router' && node.type === 'agent');
    const prompt = next.nodes.find((node) => node.id === 'prompt' && node.type === 'prompt');
    const handoff = next.nodes.find((node) => node.id === 'handoff' && node.type === 'handoff');

    expect(next.nodes.find((node) => node.id === 'worker-agent' && node.type === 'agent')).toMatchObject({ label: 'qa reviewer', agentFile: '.github/agents/qa-reviewer.agent.md' });
    expect(router?.calls).toEqual(['worker-agent']);
    expect(router?.handoffs).toEqual([{ label: 'Review', agent: '.github/agents/qa-reviewer.agent.md', send: false }]);
    expect(prompt?.startAgent).toBe('.github/agents/qa-reviewer.agent.md');
    expect(handoff?.targetAgent).toBe('.github/agents/qa-reviewer.agent.md');
    expect(generateAgentMarkdown(router!)).toContain('agent: ".github/agents/qa-reviewer.agent.md"');
    expect(generatePromptMarkdown(prompt!)).toContain('agent: ".github/agents/qa-reviewer.agent.md"');
  });

  it('previews rename file and reference impact before committing the label change', () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Rename preview',
      nodes: [
        { id: 'router', type: 'agent', label: 'router', agentFile: '.github/agents/router.agent.md', calls: ['Worker Agent'], outputs: [], handoffs: [{ label: 'Review', agent: '.github/agents/worker-agent.agent.md', send: false }] },
        { id: 'prompt', type: 'prompt', label: 'prompt', promptFile: '.github/prompts/prompt.prompt.md', startAgent: '.github/agents/worker-agent.agent.md' },
        { id: 'worker-agent', type: 'agent', label: 'Worker Agent', agentFile: '.github/agents/worker-agent.agent.md', calls: [], outputs: [] }
      ],
      edges: []
    };

    expect(deriveRenamePreview(pipeline, 'worker-agent', 'QA Reviewer')).toMatchObject({
      currentFile: '.github/agents/worker-agent.agent.md',
      currentLabel: 'Worker Agent',
      nextFile: '.github/agents/qa-reviewer.agent.md',
      nextLabel: 'qa reviewer',
      normalized: true,
      rewrittenReferenceCount: 3,
      updatedFiles: ['.github/agents/router.agent.md', '.github/agents/qa-reviewer.agent.md', '.github/prompts/prompt.prompt.md']
    });
  });

  it('syncs renamed file-backed reference nodes into markdown references and artifact usages', () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Rename file references',
      nodes: [
        {
          id: 'router',
          type: 'agent',
          label: 'router',
          calls: [],
          outputs: ['.github/artifacts/old-result.md'],
          inputs: ['.github/artifacts/old-result.md'],
          artifactUsages: [{ path: '.github/artifacts/old-result.md', action: 'write', instruction: 'Write $artifact.' }],
          instructionRefs: [{ target: '.github/instructions/old-docs.instructions.md', instruction: 'Use $instruction.' }],
          roleRefs: [{ target: '.github/roles/old-role.md', instruction: 'Use role.' }]
        },
        { id: 'docs', type: 'instruction', label: 'old docs', instructionFile: '.github/instructions/old-docs.instructions.md', applyTo: '**/*' },
        { id: 'role', type: 'role', label: 'old role', roleFile: '.github/roles/old-role.md' },
        { id: 'artifact', type: 'artifact', label: 'old result', path: '.github/artifacts/old-result.md' }
      ],
      edges: [{ id: 'router-artifact-artifact', from: 'router', to: 'artifact', kind: 'artifact', artifact: '.github/artifacts/old-result.md' }]
    };

    const renamedInstruction = renamePipelineNodeLabel(pipeline, 'docs', 'shared docs');
    const renamedRole = renamePipelineNodeLabel(renamedInstruction, 'role', 'frontend role');
    const next = renamePipelineNodeLabel(renamedRole, 'artifact', 'review result');
    const router = next.nodes.find((node) => node.id === 'router' && node.type === 'agent');

    expect(router?.instructionRefs).toEqual([{ target: '.github/instructions/shared-docs.instructions.md', instruction: 'Use $instruction.' }]);
    expect(router?.roleRefs).toEqual([{ target: '.github/roles/frontend-role.md', instruction: 'Use role.' }]);
    expect(router?.inputs).toEqual(['.github/artifacts/review-result.md']);
    expect(router?.outputs).toEqual(['.github/artifacts/review-result.md']);
    expect(router?.artifactUsages).toEqual([{ path: '.github/artifacts/review-result.md', action: 'write', instruction: 'Write $artifact.' }]);
    expect(next.edges).toEqual([{ id: 'router-artifact-artifact', from: 'router', to: 'artifact', kind: 'artifact', artifact: '.github/artifacts/review-result.md' }]);
  });

  it('syncs instruction canvas connections into referencing node instruction refs', () => {
    const pipeline: AgentPipeline = {
      ...basePipeline(),
      nodes: [
        ...basePipeline().nodes,
        { id: 'docs', type: 'instruction', label: 'Docs', instructionFile: '.github/instructions/docs.instructions.md', applyTo: '**/*.md' }
      ]
    };

    const next = connectPipelineNodes(pipeline, 'docs', 'router');
    const router = next.nodes.find((node) => node.id === 'router' && node.type === 'agent');

    expect(router?.type).toBe('agent');
    expect(router?.instructionRefs).toEqual([{ target: '.github/instructions/docs.instructions.md' }]);
    expect(next.edges).toContainEqual({ id: 'docs-instruction-router', from: 'docs', to: 'router', kind: 'instruction', label: 'instructs', artifact: undefined });
    expect(generateAgentMarkdown(router!)).toContain('<!--agent-flow:begin instruction-ref target=".github/instructions/docs.instructions.md"-->');
    expect(deriveVisibleFlowEdges(next).map((edge) => [edge.source, edge.target, edge.label])).toContainEqual(['docs', 'router', 'instructs']);
  });

  it('syncs reverse instruction canvas connections into referencing node instruction refs', () => {
    const pipeline: AgentPipeline = {
      ...basePipeline(),
      nodes: [
        ...basePipeline().nodes,
        { id: 'docs', type: 'instruction', label: 'Docs', instructionFile: '.github/instructions/docs.instructions.md', applyTo: '**/*.md' }
      ]
    };

    const next = connectPipelineNodes(pipeline, 'start', 'docs');
    const prompt = next.nodes.find((node) => node.id === 'start' && node.type === 'prompt');

    expect(prompt?.type).toBe('prompt');
    expect(prompt?.instructionRefs).toEqual([{ target: '.github/instructions/docs.instructions.md' }]);
    expect(next.edges).toContainEqual({ id: 'docs-instruction-start', from: 'docs', to: 'start', kind: 'instruction', label: 'instructs', artifact: undefined });
    expect(generatePromptMarkdown(prompt!)).toContain('<!--agent-flow:begin instruction-ref target=".github/instructions/docs.instructions.md"-->');
    expect(deriveVisibleFlowEdges(next).map((edge) => [edge.source, edge.target, edge.label])).toContainEqual(['docs', 'start', 'instructs']);
  });

  it('does not duplicate references or edges when the same connection is made twice', () => {
    const once = connectPipelineNodes(basePipeline(), 'router', 'worker');
    const twice = connectPipelineNodes(once, 'router', 'worker');
    const router = twice.nodes.find((node) => node.id === 'router' && node.type === 'agent');

    expect(router?.type).toBe('agent');
    expect(router?.calls).toEqual(['worker']);
    expect(twice.edges).toHaveLength(1);
  });
});

it('removes node references and edges when nodes are deleted from the canvas', () => {
  const pipeline = connectPipelineNodes(connectPipelineNodes(basePipeline(), 'router', 'worker'), 'router', 'artifact');
  const next = deletePipelineNodes(pipeline, ['worker', 'artifact']);
  const router = next.nodes.find((node) => node.id === 'router' && node.type === 'agent');

  expect(router?.type).toBe('agent');
  expect(router?.calls).toEqual([]);
  expect(router?.outputs).toEqual([]);
  expect(router?.artifactUsages).toEqual([]);
  expect(next.edges).toEqual([]);
});

it('removes backing references when visible reference edges are deleted from the canvas', () => {
  const pipeline: AgentPipeline = {
    version: 1,
    name: 'Reference deletion',
    nodes: [
      { id: 'prompt', type: 'prompt', label: 'Prompt', requiredArtifacts: ['.github/artifacts/result.md'], artifactUsages: [{ path: '.github/artifacts/result.md', action: 'read' }], instructionRefs: [{ target: '.github/instructions/docs.instructions.md' }] },
      { id: 'router', type: 'agent', label: 'Router', calls: ['worker'], inputs: [], outputs: ['.github/artifacts/result.md'], artifactUsages: [{ path: '.github/artifacts/result.md', action: 'write' }], instructionRefs: [{ target: '.github/instructions/docs.instructions.md' }] },
      { id: 'worker', type: 'agent', label: 'Worker', calls: [], inputs: [], outputs: [] },
      { id: 'artifact', type: 'artifact', label: 'Result', path: '.github/artifacts/result.md' },
      { id: 'docs', type: 'instruction', label: 'Docs', instructionFile: '.github/instructions/docs.instructions.md', applyTo: '**/*.md' }
    ],
    edges: []
  };

  const next = deletePipelineEdges(pipeline, [
    'ref:agent:router:calls:worker',
    'ref:agent.artifactUsages:router:artifact:write',
    'ref:prompt.artifactUsages:artifact:prompt:read',
    'ref:agent.instructionRefs:docs:router',
    'ref:prompt.instructionRefs:docs:prompt'
  ]);
  const prompt = next.nodes.find((node) => node.id === 'prompt' && node.type === 'prompt');
  const router = next.nodes.find((node) => node.id === 'router' && node.type === 'agent');

  expect(prompt?.requiredArtifacts).toEqual([]);
  expect(prompt?.artifactUsages).toEqual([]);
  expect(prompt?.instructionRefs).toEqual([]);
  expect(router?.calls).toEqual([]);
  expect(router?.outputs).toEqual([]);
  expect(router?.artifactUsages).toEqual([]);
  expect(router?.instructionRefs).toEqual([]);
});

it('removes backing references when edges are deleted from the canvas', () => {
  const pipeline = connectPipelineNodes(connectPipelineNodes(basePipeline(), 'router', 'worker'), 'artifact', 'router');
  const next = deletePipelineEdges(pipeline, ['router-flow-worker', 'artifact-artifact-router']);
  const router = next.nodes.find((node) => node.id === 'router' && node.type === 'agent');

  expect(router?.type).toBe('agent');
  expect(router?.calls).toEqual([]);
  expect(router?.inputs).toEqual([]);
  expect(router?.artifactUsages).toEqual([]);
  expect(next.edges).toEqual([]);
});
