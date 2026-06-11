import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadOrInferPipeline } from '../src/pipeline/scanner';
import { AgentPipeline } from '../src/pipeline/types';
import { writeGeneratedFiles, writePipelineViewState } from '../src/webview/filePersistence';

async function exists(file: string): Promise<boolean> {
  try { await fs.access(file); return true; } catch { return false; }
}

describe('webview file persistence', () => {
  it('writes every Markdown-backed node type from webview state and can live-parse it back', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agentflow-file-persist-'));
    const logs: string[] = [];
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Persist all node files',
      nodes: [
        { id: 'new-agent-1', type: 'agent', label: 'New agent', agentFile: '.github/agents/new-agent-1.agent.md', tools: ['read'], calls: [], inputs: [], outputs: [], position: { x: 10, y: 20 } },
        { id: 'new-prompt-1', type: 'prompt', label: 'New prompt', promptFile: '.github/prompts/new-prompt-1.prompt.md', tools: ['search'], workflow: [], constraints: [], position: { x: 30, y: 40 } },
        { id: 'new-instruction-1', type: 'instruction', label: 'New instruction', instructionFile: '.github/instructions/new-instruction-1.instructions.md', position: { x: 50, y: 60 } },
        { id: 'new-skill-1', type: 'skill', label: 'New skill', skillFile: '.github/skills/new-skill-1/SKILL.md', activationCriteria: [], procedure: [], position: { x: 70, y: 80 } },
        { id: 'new-artifact-1', type: 'artifact', label: 'New artifact', path: '.agent-output/new-artifact-1.md', position: { x: 90, y: 100 } },
        { id: 'new-gate-1', type: 'gate', label: 'New gate', condition: 'Define condition' },
        { id: 'new-handoff-1', type: 'handoff', label: 'New handoff' },
        { id: 'new-mcp-server-1', type: 'mcp-server', label: 'New MCP server' }
      ],
      edges: []
    };

    await writePipelineViewState(workspace, pipeline, (message) => logs.push(message));
    await writeGeneratedFiles(workspace, pipeline, undefined, (message) => logs.push(message));

    expect(await exists(path.join(workspace, '.github/agent-flow.json'))).toBe(true);
    expect(await exists(path.join(workspace, '.github/agents/new-agent-1.agent.md'))).toBe(true);
    expect(await exists(path.join(workspace, '.github/prompts/new-prompt-1.prompt.md'))).toBe(true);
    expect(await exists(path.join(workspace, '.github/instructions/new-instruction-1.instructions.md'))).toBe(true);
    expect(await exists(path.join(workspace, '.github/skills/new-skill-1/SKILL.md'))).toBe(true);
    expect(await exists(path.join(workspace, '.agent-output/new-artifact-1.md'))).toBe(true);
    expect(await exists(path.join(workspace, '.github/gates/new-gate-1.md'))).toBe(false);
    expect(await exists(path.join(workspace, '.github/handoffs/new-handoff-1.md'))).toBe(false);
    expect(await exists(path.join(workspace, '.github/mcp-servers/new-mcp-server-1.md'))).toBe(false);
    expect(logs.some((message) => message.includes('wrote .github/prompts/new-prompt-1.prompt.md'))).toBe(true);
    expect(logs.some((message) => message.includes('wrote .github/instructions/new-instruction-1.instructions.md'))).toBe(true);

    const reloaded = await loadOrInferPipeline(workspace);
    expect(reloaded.nodes.find((node) => node.id === 'new-agent-1' && node.type === 'agent')).toMatchObject({ agentFile: '.github/agents/new-agent-1.agent.md', position: { x: 10, y: 20 } });
    expect(reloaded.nodes.find((node) => node.id === 'new-prompt-1' && node.type === 'prompt')).toMatchObject({ promptFile: '.github/prompts/new-prompt-1.prompt.md', tools: ['search'], position: { x: 30, y: 40 } });
    expect(reloaded.nodes.find((node) => node.id === 'new-instruction-1' && node.type === 'instruction')).toMatchObject({ instructionFile: '.github/instructions/new-instruction-1.instructions.md', label: 'New instruction', position: { x: 50, y: 60 } });
    expect(reloaded.nodes.find((node) => node.id === 'new-skill-1' && node.type === 'skill')).toMatchObject({ skillFile: '.github/skills/new-skill-1/SKILL.md', position: { x: 70, y: 80 } });
    expect(reloaded.nodes.find((node) => node.id === '-agent-output-new-artifact-1-md' && node.type === 'artifact')).toMatchObject({ path: '.agent-output/new-artifact-1.md', position: { x: 90, y: 100 } });
  });

  it('removes stale generated files when a managed node file path changes', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agentflow-file-rename-'));
    const before: AgentPipeline = {
      version: 1,
      name: 'Rename',
      nodes: [{ id: 'new-prompt-1', type: 'prompt', label: 'New prompt', promptFile: '.github/prompts/new-prompt-1.prompt.md' }],
      edges: []
    };
    const after: AgentPipeline = {
      version: 1,
      name: 'Rename',
      nodes: [{ id: 'new-prompt-1', type: 'prompt', label: 'Release Notes', promptFile: '.github/prompts/release-notes.prompt.md' }],
      edges: []
    };

    await writeGeneratedFiles(workspace, before);
    await writeGeneratedFiles(workspace, after, before);

    expect(await exists(path.join(workspace, '.github/prompts/new-prompt-1.prompt.md'))).toBe(false);
    expect(await exists(path.join(workspace, '.github/prompts/release-notes.prompt.md'))).toBe(true);
  });
});
