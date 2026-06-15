import { describe, expect, it } from 'vitest';
import { renderAgentFlowReport, renderActivityCsv } from '../src/activity/exportReport';
import { AgentFlowActivityEvent } from '../src/activity/types';
import { AgentPipeline } from '../src/pipeline/types';
import { validatePipeline } from '../src/pipeline/validator';
import { calculateRiskScore } from '../src/pipeline/riskScore';

const pipeline: AgentPipeline = {
  version: 1,
  name: 'Export demo',
  nodes: [
    { id: 'router', type: 'agent', label: 'router', tools: ['read/readFile'], calls: ['worker'], outputs: ['.github/artifacts/plan.md'] },
    { id: 'worker', type: 'agent', label: 'worker', tools: ['edit/editFiles'], calls: [], inputs: ['.github/artifacts/plan.md'], outputs: [] },
    { id: 'plan', type: 'artifact', label: 'plan', path: '.github/artifacts/plan.md' }
  ],
  edges: [{ id: 'router-worker', from: 'router', to: 'worker', kind: 'flow' }]
};

const events: AgentFlowActivityEvent[] = [
  { id: 'a1', timestamp: '2026-06-15T10:00:00.000Z', sessionId: 's1', phase: 'tool', nodeId: 'router', toolName: 'read/readFile', summary: 'Read routing file.' },
  { id: 'a2', timestamp: '2026-06-15T10:00:01.000Z', sessionId: 's1', phase: 'artifact', nodeId: 'router', artifactPath: '.github/artifacts/plan.md', summary: 'Updated plan, with comma.', tokenEstimate: 42 },
  { id: 'a3', timestamp: '2026-06-15T10:00:02.000Z', sessionId: 's1', phase: 'failed', nodeId: 'worker', summary: 'Failed "quoted" step.', severity: 'error' }
];

describe('Agent Flow export report', () => {
  it('renders a shareable Markdown report without raw prompt or tool output', () => {
    const report = renderAgentFlowReport({
      pipeline,
      findings: validatePipeline(pipeline),
      risk: calculateRiskScore(pipeline),
      activityEvents: events
    });

    expect(report).toContain('# Agent Flow Report: Export demo');
    expect(report).toContain('## Pipeline Summary');
    expect(report).toContain('- Nodes: 3');
    expect(report).toContain('## Nodes By Type');
    expect(report).toContain('- agent: 2');
    expect(report).toContain('## Tool Summary');
    expect(report).toContain('- read/readFile: 1 node');
    expect(report).toContain('## Artifact Boundaries');
    expect(report).toContain('.github/artifacts/plan.md');
    expect(report).toContain('## Recent Activity');
    expect(report).toContain('Updated plan, with comma.');
    expect(report).not.toContain('raw prompt');
  });

  it('exports activity CSV with safe escaping and stable headers', () => {
    expect(renderActivityCsv(events)).toBe([
      'timestamp,session,node,phase,summary,tool,path,severity,tokens,inputTokens,outputTokens',
      '2026-06-15T10:00:00.000Z,s1,router,tool,Read routing file.,read/readFile,,,,,',
      '2026-06-15T10:00:01.000Z,s1,router,artifact,"Updated plan, with comma.",,.github/artifacts/plan.md,,42,,',
      '2026-06-15T10:00:02.000Z,s1,worker,failed,"Failed ""quoted"" step.",,,error,,,'
    ].join('\n'));
  });
});
