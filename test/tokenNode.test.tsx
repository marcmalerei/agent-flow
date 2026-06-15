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
    const html = renderToStaticMarkup(<TokenNode data={{ label, type: 'artifact', tokenBadge: '~77 tok', tokenColor: 'var(--vscode-charts-green)', sourcePosition: 'right', targetPosition: 'left' }} />);

    expect(html).toContain('class="flow-node-label"');
    expect(html).toContain(`title="${label}"`);
  });
});
