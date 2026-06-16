import { describe, expect, it } from 'vitest';
import { activeEdgeClass, edgeTooltip } from '../src/webview/edgeClasses';

describe('edge visual classes', () => {
  it('classifies active read, write, and handoff edges for targeted animation', () => {
    expect(activeEdgeClass({ label: 'reads', data: { derivedFrom: 'agent.inputs', kind: 'reference', artifact: '.github/artifacts/plan.md' } })).toBe('active-read');
    expect(activeEdgeClass({ label: 'writes', data: { derivedFrom: 'agent.outputs', kind: 'reference', artifact: '.github/artifacts/result.md' } })).toBe('active-write');
    expect(activeEdgeClass({ label: 'handoff', data: { derivedFrom: 'handoff.targetAgent', kind: 'handoff' } })).toBe('active-handoff');
  });

  it('builds hover tooltips with source, target, label, and derivation context', () => {
    expect(edgeTooltip({
      source: 'router',
      target: 'plan',
      label: 'writes',
      data: { derivedFrom: 'agent.outputs', kind: 'reference', artifact: '.github/artifacts/plan.md' }
    }, 'router agent', 'plan artifact')).toBe('router agent -> plan artifact · writes · agent.outputs');
  });
});
