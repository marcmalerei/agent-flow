import { describe, expect, it } from 'vitest';
import { graphNodeDisplayLabel, graphNodeFullLabel, nodeTypeColor, edgeGradientId, edgeMarkerColor } from '../src/webview/nodeDisplay';
import { PipelineNode } from '../src/pipeline/types';

describe('node display helpers', () => {
  it('shows artifact labels relative to .github/artifacts', () => {
    const node: PipelineNode = {
      id: 'ticket',
      type: 'artifact',
      label: '.github/artifacts/results/ticket.md',
      path: '.github/artifacts/results/ticket.md'
    };

    expect(graphNodeDisplayLabel(node)).toBe('results/ticket.md');
    expect(graphNodeFullLabel(node)).toBe('.github/artifacts/results/ticket.md');
  });

  it('normalizes artifact display paths before shortening them', () => {
    const node: PipelineNode = {
      id: 'ticket',
      type: 'artifact',
      label: '.github\\artifacts\\results\\ticket.md',
      path: '.github\\artifacts\\results\\ticket.md'
    };

    expect(graphNodeDisplayLabel(node)).toBe('results/ticket.md');
  });

  it('keeps non-artifact node labels unchanged for display', () => {
    const node: PipelineNode = { id: 'router', type: 'agent', label: 'router', tools: [], calls: [], outputs: [] };

    expect(graphNodeDisplayLabel(node)).toBe('router');
  });

  it('derives stable edge gradient ids and target-colored markers', () => {
    const source: PipelineNode = { id: 'router', type: 'agent', label: 'router', tools: [], calls: [], outputs: [] };
    const target: PipelineNode = { id: 'plan', type: 'artifact', label: '.github/artifacts/plan.md', path: '.github/artifacts/plan.md' };

    expect(edgeGradientId('router->plan/read')).toBe('agentflow-edge-gradient-router--plan-read');
    expect(nodeTypeColor(source.type)).toBe('var(--vscode-charts-blue)');
    expect(edgeMarkerColor(target)).toBe('var(--vscode-charts-green)');
  });
});
