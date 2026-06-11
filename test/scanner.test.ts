import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { inferPipelineFromWorkspace } from '../src/pipeline/scanner';

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
});
