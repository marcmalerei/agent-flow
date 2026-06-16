import { describe, expect, test } from 'vitest';
import { AgentPipeline } from '../src/pipeline/types';
import { validatePipeline } from '../src/pipeline/validator';
import { applyDiagnosticQuickFix } from '../src/webview/diagnosticQuickFixes';

function basePipeline(nodes: AgentPipeline['nodes']): AgentPipeline {
  return { version: 1, name: 'diagnostics-test', nodes, edges: [] };
}

describe('actionable diagnostics', () => {
  test('adds exact instruction file, pattern, and actions for broad applyTo findings', () => {
    const findings = validatePipeline(basePipeline([
      {
        id: 'global-guidance',
        type: 'instruction',
        label: 'global guidance',
        instructionFile: '.github/instructions/global-guidance.instructions.md',
        applyTo: '**/*'
      }
    ]));

    const finding = findings.find((item) => item.ruleId === 'broad-apply-to');

    expect(finding).toMatchObject({
      title: 'Broad instruction scope',
      entity: {
        kind: 'file',
        id: '.github/instructions/global-guidance.instructions.md',
        filePath: '.github/instructions/global-guidance.instructions.md'
      },
      details: {
        pattern: '**/*'
      },
      suggestedFix: 'Narrow applyTo to the file patterns that should receive this instruction.'
    });
    expect(finding?.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'focusNode', nodeId: 'global-guidance', label: 'Focus node' }),
      expect.objectContaining({ kind: 'openFile', filePath: '.github/instructions/global-guidance.instructions.md', label: 'Open file' })
    ]));
  });

  test('offers a safe artifact quick fix for agents without output boundaries', () => {
    const findings = validatePipeline(basePipeline([
      {
        id: 'planner',
        type: 'agent',
        label: 'planner',
        agentFile: '.github/agents/planner.agent.md',
        tools: ['read/readFile']
      }
    ]));

    const finding = findings.find((item) => item.ruleId === 'agent-no-output');

    expect(finding).toMatchObject({
      title: 'Missing output artifact',
      entity: {
        kind: 'node',
        id: 'planner',
        label: 'planner',
        filePath: '.github/agents/planner.agent.md'
      },
      suggestedFix: 'Add or select an output artifact so downstream agents can consume this result.'
    });
    expect(finding?.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'focusNode', nodeId: 'planner', sectionId: 'artifacts' }),
      expect.objectContaining({ kind: 'quickFix', quickFixId: 'create-output-artifact', nodeId: 'planner' })
    ]));
  });

  test('applies the missing output artifact quick fix deterministically', () => {
    const pipeline = basePipeline([
      {
        id: 'planner',
        type: 'agent',
        label: 'planner',
        agentFile: '.github/agents/planner.agent.md',
        tools: ['read/readFile']
      }
    ]);
    const finding = validatePipeline(pipeline).find((item) => item.ruleId === 'agent-no-output');

    const result = applyDiagnosticQuickFix(pipeline, finding?.actions?.find((action) => action.kind === 'quickFix'));

    const agent = result?.pipeline.nodes.find((node) => node.type === 'agent' && node.id === 'planner');
    const artifact = result?.pipeline.nodes.find((node) => node.type === 'artifact' && node.id === 'planner-output');
    expect(agent?.type).toBe('agent');
    expect(agent?.outputs).toEqual(['.github/artifacts/planner-output.md']);
    expect(agent?.artifactUsages).toEqual([
      { path: '.github/artifacts/planner-output.md', action: 'write', instruction: 'Write this node result to $artifact.' }
    ]);
    expect(artifact).toMatchObject({
      id: 'planner-output',
      label: 'planner output',
      path: '.github/artifacts/planner-output.md'
    });
    expect(result?.selectedId).toBe('planner');
    expect(result?.sectionId).toBe('artifacts');
  });
});
