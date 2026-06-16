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
    }, 'router agent', 'plan artifact')).toBe('router agent -> plan artifact · writes · Why this edge exists: router agent declares .github/artifacts/plan.md as an output artifact. Source: agent.outputs. Artifact: .github/artifacts/plan.md.');
  });

  it('explains stored and handoff edge provenance in user-facing language', () => {
    expect(edgeTooltip({
      source: 'handoff',
      target: 'worker',
      label: 'Escalate',
      data: { derivedFrom: 'handoff.targetAgent', kind: 'handoff' }
    }, 'Escalate handoff', 'worker agent')).toContain('Why this edge exists: Escalate handoff targets worker agent.');
    expect(edgeTooltip({
      source: 'router',
      target: 'worker',
      label: 'calls',
      data: { derivedFrom: 'pipeline.edges', kind: 'flow' }
    }, 'router agent', 'worker agent')).toContain('Source: pipeline.edges.');
  });
});
