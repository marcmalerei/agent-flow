import { describe, expect, it } from 'vitest';

import type { AgentPipeline } from '../src/pipeline/types';
import { layoutFlowNodes } from '../src/webview/flowLayout';

describe('compact flow layout', () => {
  it('keeps explicit positions for disconnected singleton support nodes', () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Disconnected support nodes',
      nodes: [
        { id: 'prompt', type: 'prompt', label: 'Prompt', position: { x: 40, y: 40 } },
        { id: 'agent', type: 'agent', label: 'Agent', position: { x: 320, y: 40 } },
        { id: 'artifact', type: 'artifact', label: 'Artifact', path: '.github/artifacts/result.md', position: { x: 320, y: 320 } },
        { id: 'instruction', type: 'instruction', label: 'Instruction', instructionFile: '.github/instructions/instruction.instructions.md', position: { x: 120, y: 220 } },
        { id: 'hook', type: 'hook', label: 'Hook', trigger: 'beforeWrite', position: { x: 560, y: 220 } },
      ],
      edges: [
        { id: 'prompt-agent', from: 'prompt', to: 'agent', kind: 'prompt' },
        { id: 'agent-artifact', from: 'agent', to: 'artifact', kind: 'artifact', artifact: '.github/artifacts/result.md' },
      ],
    };

    const positions = layoutFlowNodes(pipeline, 'compact');

    expect(positions.get('instruction')).toEqual({ x: 120, y: 220 });
    expect(positions.get('hook')).toEqual({ x: 560, y: 220 });
  });
});
