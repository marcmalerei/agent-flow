import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringifyPipeline } from '../src/pipeline/parser';
import { loadOrInferPipeline, inferPipelineFromWorkspace } from '../src/pipeline/scanner';

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
