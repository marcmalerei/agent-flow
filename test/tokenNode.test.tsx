import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { TokenNode } from '../src/webview/TokenNode';

describe('TokenNode', () => {
  it('renders source and target handles so React Flow can draw edges', () => {
    const html = renderToStaticMarkup(<ReactFlowProvider><TokenNode data={{ label: 'Router', type: 'agent', tokenBadge: '~42 tok', tokenColor: 'var(--vscode-charts-blue)', sourcePosition: 'right', targetPosition: 'left' }} /></ReactFlowProvider>);

    expect(html).toMatch(/class="[^"]*react-flow__handle[^"]* target /);
    expect(html).toMatch(/class="[^"]*react-flow__handle[^"]* source /);
    expect(html).toContain('data-handlepos="right"');
    expect(html).toContain('data-handlepos="left"');
  });

  it('passes the node color to the token badge', () => {
    const html = renderToStaticMarkup(<ReactFlowProvider><TokenNode data={{ label: 'Prompt', type: 'prompt', tokenBadge: '~77 tok', tokenColor: 'var(--vscode-charts-purple)', sourcePosition: 'right', targetPosition: 'left' }} /></ReactFlowProvider>);

    expect(html).toContain('--agentflow-token-color:var(--vscode-charts-purple)');
  });
});
