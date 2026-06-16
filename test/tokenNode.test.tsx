import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TokenNode } from '../src/webview/TokenNode';

describe('TokenNode', () => {
  it('renders native source and target ports so the custom graph renderer can draw edges', () => {
    const html = renderToStaticMarkup(<TokenNode data={{ label: 'Router', type: 'agent', tokenBadge: '~42 tok', tokenColor: 'var(--vscode-charts-blue)', sourcePosition: 'right', targetPosition: 'left' }} />);

    expect(html).toMatch(/class="[^"]*node-port[^"]* node-port-target [^"]*node-port-left/);
    expect(html).toMatch(/class="[^"]*node-port[^"]* node-port-source [^"]*node-port-right/);
    expect(html).not.toContain('react-flow__handle');
  });

  it('passes the node color to the token badge', () => {
    const html = renderToStaticMarkup(<TokenNode data={{ label: 'Prompt', type: 'prompt', tokenBadge: '~77 tok', tokenColor: 'var(--vscode-charts-purple)', sourcePosition: 'right', targetPosition: 'left' }} />);

    expect(html).toContain('--agentflow-token-color:var(--vscode-charts-purple)');
  });

  it('renders long labels in a dedicated bounded label element', () => {
    const label = '.github/artifacts/results/final-review-result.md';
    const html = renderToStaticMarkup(<TokenNode data={{ label: 'results/final-review-result.md', fullLabel: label, type: 'artifact', tokenBadge: '~77 tok', tokenColor: 'var(--vscode-charts-green)', sourcePosition: 'right', targetPosition: 'left' }} />);

    expect(html).toContain('class="flow-node-label"');
    expect(html).toContain(`title="${label}"`);
    expect(html).toContain('results/final-review-result.md');
  });

  it('marks handoff nodes with a type class for compact styling', () => {
    const html = renderToStaticMarkup(<TokenNode data={{ label: 'handoff to reviewer', type: 'handoff', tokenBadge: '~42 tok', tokenColor: 'var(--vscode-editorWarning-foreground)', sourcePosition: 'right', targetPosition: 'left' }} />);

    expect(html).toContain('flow-node-type-handoff');
  });

  it('renders token and runtime badges in reserved slots away from the title', () => {
    const html = renderToStaticMarkup(<TokenNode data={{
      label: '.github/artifacts/results/final-review-result.md',
      type: 'artifact',
      tokenBadge: '~77 tok',
      tokenColor: 'var(--vscode-charts-green)',
      dirty: true,
      activity: {
        nodeId: 'artifact',
        phase: 'artifact',
        summary: 'Updated final review result',
        count: 1,
        freshness: 'recent',
        updatedAt: '2026-06-16T10:00:00.000Z',
        artifactPath: '.github/artifacts/results/final-review-result.md'
      },
      sourcePosition: 'right',
      targetPosition: 'left'
    }} />);

    expect(html).toContain('class="node-meta-slot"');
    expect(html).toContain('node-body-slot');
    expect(html).toContain('class="node-status-slot"');
    expect(html.indexOf('node-meta-slot')).toBeLessThan(html.indexOf('flow-node-label'));
    expect(html.indexOf('flow-node-label')).toBeLessThan(html.indexOf('node-status-slot'));
  });
});
