import { describe, expect, it } from 'vitest';
import { edgeReadingLevelClass, graphReadingLevelClassName, graphReadingLevels, nodeReadingLevelClass, type GraphReadingLevel } from '../src/webview/graphReadingLevels';
import type { PipelineNodeType } from '../src/pipeline/types';

const edge = (derivedFrom: string, label = 'connects', active = false) => ({
  edge: { label, data: { derivedFrom, kind: 'reference' } },
  active
});

describe('graph reading levels', () => {
  it('defines a stable toolbar order for graph reading', () => {
    expect(graphReadingLevels.map((level) => level.id)).toEqual(['overview', 'data-flow', 'references', 'run-activity', 'selected-path']);
    expect(graphReadingLevels.map((level) => level.label)).toEqual(['Overview', 'Data flow', 'References', 'Run activity', 'Selected path']);
    expect(graphReadingLevelClassName('data-flow')).toBe('reading-level-data-flow');
  });

  it('classifies nodes for overview, activity, and selected-path reading', () => {
    expect(nodeReadingLevelClass('artifact', 'overview', { active: false, related: false, selected: false })).toBe('reading-muted');
    expect(nodeReadingLevelClass('agent', 'overview', { active: false, related: false, selected: false })).toBe('reading-primary');
    expect(nodeReadingLevelClass('agent', 'run-activity', { active: true, related: false, selected: false })).toBe('reading-primary');
    expect(nodeReadingLevelClass('agent', 'run-activity', { active: false, related: false, selected: false })).toBe('reading-muted');
    expect(nodeReadingLevelClass('instruction' as PipelineNodeType, 'selected-path', { active: false, related: false, selected: false })).toBe('reading-muted');
    expect(nodeReadingLevelClass('instruction' as PipelineNodeType, 'selected-path', { active: false, related: true, selected: false })).toBe('reading-related');
  });

  it('classifies edges for data flow, references, and selected-path reading', () => {
    expect(edgeReadingLevelClass(edge('agent.outputs', 'writes').edge, 'data-flow', { active: false, selected: false })).toContain('reading-write');
    expect(edgeReadingLevelClass(edge('agent.inputs', 'reads').edge, 'data-flow', { active: false, selected: false })).toContain('reading-read');
    expect(edgeReadingLevelClass(edge('agent.instructionRefs').edge, 'references', { active: false, selected: false })).toBe('reading-primary');
    expect(edgeReadingLevelClass(edge('agent.outputs').edge, 'references', { active: false, selected: false })).toBe('reading-muted');
    expect(edgeReadingLevelClass(edge('handoff.targetAgent').edge, 'overview', { active: false, selected: false })).toBe('reading-primary');
    expect(edgeReadingLevelClass(edge('agent.outputs').edge, 'overview', { active: false, selected: false })).toBe('reading-muted');
    expect(edgeReadingLevelClass(edge('agent.outputs').edge, 'run-activity', { active: true, selected: false })).toBe('reading-primary');
    expect(edgeReadingLevelClass(edge('agent.outputs').edge, 'selected-path' as GraphReadingLevel, { active: false, selected: false })).toBe('reading-muted');
  });
});
