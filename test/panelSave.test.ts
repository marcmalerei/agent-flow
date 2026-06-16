import { describe, expect, it } from 'vitest';
import { handleOpenNodeDiffMessage, handlePersistPipelineMessage, handleSavePipelineMessage, handleWriteMarkdownFilesMessage } from '../src/webview/panelMessages';
import { AgentPipeline } from '../src/pipeline/types';

describe('webview save handling', () => {
  it('persists pipeline view state and markdown files without confirmation', async () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Auto save',
      nodes: [{ id: 'agent', type: 'agent', label: 'Agent', tools: ['codebase'], calls: ['"Worker"'], outputs: [] }, { id: 'worker', type: 'agent', label: 'Worker', outputs: [] }],
      edges: []
    };
    const calls: string[] = [];

    const result = await handlePersistPipelineMessage({
      message: { command: 'persistPipeline', pipeline, selectedId: 'agent' },
      workspace: '/workspace',
      writePipeline: async (_workspace, saved) => {
        calls.push(`view:${saved.nodes[0].type === 'agent' ? `${saved.nodes[0].calls?.[0]}:${saved.nodes[0].tools?.join(',')}` : ''}`);
      },
      writeMarkdownFiles: async (_workspace, saved) => {
        calls.push(`markdown:${saved.nodes.length}`);
      },
      postState: async (_pipeline, selectedId) => {
        calls.push(`state:${selectedId}`);
      }
    });

    expect(result.nodes[0].type === 'agent' && result.nodes[0].calls).toEqual(['worker']);
    expect(calls).toEqual(['view:worker:read,search', 'markdown:2', 'state:agent']);
  });

  it('normalizes save payloads before the host decides how to persist them', async () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Save only',
      nodes: [{ id: 'agent', type: 'agent', label: 'Agent', tools: ['codebase'], calls: ['"Worker"'], outputs: [] }, { id: 'worker', type: 'agent', label: 'Worker', outputs: [] }],
      edges: []
    };
    const calls: string[] = [];

    await handleSavePipelineMessage({
      message: { command: 'savePipeline', pipeline, selectedId: 'agent' },
      workspace: '/workspace',
      writePipeline: async (_workspace, saved) => {
        calls.push(`pipeline:${saved.nodes[0].type === 'agent' ? `${saved.nodes[0].calls?.[0]}:${saved.nodes[0].tools?.join(',')}` : ''}`);
      },
      postState: async () => {
        calls.push('state');
      },
      showSavedMessage: async () => {
        calls.push('message');
      }
    });

    expect(calls).toEqual(['pipeline:worker:read,search', 'state', 'message']);
  });

  it('writes generated Markdown files after confirmation', async () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Write markdown',
      nodes: [
        { id: 'prompt', type: 'prompt', label: 'Prompt', startAgent: '"Agent"' },
        { id: 'agent', type: 'agent', label: 'Agent', outputs: ['.github/artifacts/result.md'] },
        { id: 'artifact', type: 'artifact', label: 'Result', path: '.github/artifacts/result.md' }
      ],
      edges: []
    };
    const calls: string[] = [];

    const result = await handleWriteMarkdownFilesMessage({
      message: { command: 'writeMarkdownFiles', pipeline, selectedId: 'agent' },
      workspace: '/workspace',
      confirmWrite: async (count) => {
        calls.push(`confirm:${count}`);
        return true;
      },
      writeMarkdownFiles: async (_workspace, saved) => {
        calls.push(`write:${saved.nodes.find((node) => node.type === 'prompt' && node.id === 'prompt')?.type === 'prompt' ? 'ok' : 'missing'}`);
      },
      postState: async (_pipeline, selectedId) => {
        calls.push(`state:${selectedId}`);
      },
      showWrittenMessage: async (count) => {
        calls.push(`message:${count}`);
      }
    });

    expect(result?.nodes.find((node) => node.type === 'prompt' && node.id === 'prompt')?.type === 'prompt' && result.nodes.find((node) => node.type === 'prompt' && node.id === 'prompt')?.startAgent).toBe('agent');
    expect(calls).toEqual(['confirm:3', 'write:ok', 'state:agent', 'message:3']);
  });

  it('does not write generated Markdown files when confirmation is cancelled', async () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Cancelled',
      nodes: [{ id: 'agent', type: 'agent', label: 'Agent', outputs: [] }],
      edges: []
    };
    const calls: string[] = [];

    const result = await handleWriteMarkdownFilesMessage({
      message: { command: 'writeMarkdownFiles', pipeline },
      workspace: '/workspace',
      confirmWrite: async (count) => {
        calls.push(`confirm:${count}`);
        return false;
      },
      writeMarkdownFiles: async () => {
        calls.push('write');
      },
      postState: async () => {
        calls.push('state');
      },
      showWrittenMessage: async () => {
        calls.push('message');
      }
    });

    expect(result).toBeUndefined();
    expect(calls).toEqual(['confirm:1']);
  });

  it('opens a diff between draft node Markdown and the workspace file', async () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Diff',
      nodes: [{ id: 'agent', type: 'agent', label: 'Agent', agentFile: '.github/agents/agent.agent.md', tools: ['read'], calls: [], outputs: [] }],
      edges: []
    };
    const calls: string[] = [];

    await handleOpenNodeDiffMessage({
      message: { command: 'openNodeDiff', pipeline, nodeId: 'agent' },
      workspace: '/workspace',
      writeTempDraft: async (relativePath, content) => {
        calls.push(`temp:${relativePath}:${content.includes('name: "agent"')}`);
        return `/tmp/${relativePath}`;
      },
      openDiff: async (left, right, title) => {
        calls.push(`diff:${left}:${right}:${title}`);
      },
      showErrorMessage: async (message) => {
        calls.push(`error:${message}`);
      }
    });

    expect(calls).toEqual([
      'temp:.github/agents/agent.agent.md:true',
      'diff:/tmp/.github/agents/agent.agent.md:/workspace/.github/agents/agent.agent.md:Agent Flow draft vs external file'
    ]);
  });
});
