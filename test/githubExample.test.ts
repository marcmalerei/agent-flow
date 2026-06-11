import { describe, expect, it } from 'vitest';
import { inferPipelineFromWorkspace } from '../src/pipeline/scanner';
import { deriveVisibleFlowEdges } from '../src/webview/graph';
import { validatePipeline } from '../src/pipeline/validator';

describe('repository .github example data', () => {
  it('covers agent, prompt, instruction, skill, hook, MCP, handoff, artifact, and customization references', async () => {
    const pipeline = await inferPipelineFromWorkspace(process.cwd());
    const nodesById = new Map(pipeline.nodes.map((node) => [node.id, node]));
    const orchestrator = nodesById.get('orchestrator');
    const prompt = nodesById.get('implementation');
    const shared = nodesById.get('shared');

    expect(orchestrator?.type).toBe('agent');
    if (orchestrator?.type !== 'agent') throw new Error('orchestrator agent missing');
    expect(orchestrator.model).toEqual(['GPT-5 (copilot)', 'Claude Sonnet 4.5 (copilot)']);
    expect(orchestrator.tools).toEqual(['agent', 'read', 'search']);
    expect(orchestrator.calls).toEqual(['worker']);
    expect(orchestrator.handoffs).toEqual([{ label: 'Quality Review', agent: '.github/agents/qa.agent.md', prompt: 'Review the worker output and note risks.', send: false, model: 'GPT-4o (copilot)' }]);
    expect(orchestrator.hooks).toEqual({ SessionStart: [{ type: 'command', command: 'echo "AgentFlow example started"' }] });
    expect(orchestrator.mcpServers).toEqual([{ name: 'filesystem-example', command: 'npx', args: '["-y","@modelcontextprotocol/server-filesystem","."]' }]);
    expect(orchestrator.inputs).toEqual(['.agent-output/example-input.md']);
    expect(orchestrator.outputs).toEqual(['.agent-output/example-plan.md']);
    expect(orchestrator.instructionRefs).toEqual([{ target: '.github/instructions/shared.instructions.md' }]);

    expect(nodesById.get('worker')?.type).toBe('agent');
    expect(nodesById.get('qa')?.type).toBe('agent');
    expect(prompt?.type).toBe('prompt');
    expect(shared?.type).toBe('instruction');
    expect(nodesById.get('template')?.type).toBe('instruction');
    expect(nodesById.get('repo-audit')?.type).toBe('skill');
    expect(pipeline.nodes.some((node) => node.type === 'hook' && node.id === 'orchestrator-hook-sessionstart-1')).toBe(true);
    expect(pipeline.nodes.some((node) => node.type === 'mcp-server' && node.id === 'orchestrator-mcp-filesystem-example')).toBe(true);
    expect(pipeline.nodes.some((node) => node.type === 'handoff' && node.id === 'orchestrator-handoff-quality-review')).toBe(true);
    expect(pipeline.nodes.some((node) => node.type === 'artifact' && node.path === '.agent-output/example-plan.md')).toBe(true);

    expect(pipeline.nodes.some((node) => node.type === 'artifact' && ['.github/agents/worker.agent.md', '.github/prompts/implementation.prompt.md', '.github/instructions/shared.instructions.md'].includes(node.path))).toBe(false);
    expect(pipeline.edges).toContainEqual({ id: 'orchestrator-calls-worker', from: 'orchestrator', to: 'worker', kind: 'flow' });
    expect(pipeline.edges.some((edge) => edge.from === 'implementation' && edge.to === 'orchestrator' && edge.kind === 'prompt')).toBe(true);
    expect(pipeline.edges).toContainEqual({ id: 'orchestrator-references-implementation', from: 'orchestrator', to: 'implementation', kind: 'flow', label: 'references' });

    const visible = deriveVisibleFlowEdges(pipeline);
    expect(visible.filter((edge) => edge.source === 'shared' && edge.target === 'orchestrator')).toHaveLength(1);
    expect(visible.filter((edge) => edge.source === 'template' && edge.target === 'shared')).toHaveLength(1);
    expect(visible.filter((edge) => edge.source === 'orchestrator' && edge.target === 'worker')).toHaveLength(1);
    expect(validatePipeline(pipeline).filter((finding) => finding.severity === 'error')).toEqual([]);
  });
});
