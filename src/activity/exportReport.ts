import { AgentPipeline, PipelineNode, RiskScore, ValidationFinding } from '../pipeline/types';
import { AgentFlowActivityEvent } from './types';

export interface AgentFlowReportInput {
  pipeline: AgentPipeline;
  findings: ValidationFinding[];
  risk: RiskScore;
  activityEvents: AgentFlowActivityEvent[];
}

export function renderAgentFlowReport(input: AgentFlowReportInput): string {
  const { pipeline, findings, risk, activityEvents } = input;
  return [
    `# Agent Flow Report: ${pipeline.name}`,
    '',
    '## Pipeline Summary',
    '',
    `- Nodes: ${pipeline.nodes.length}`,
    `- Edges: ${pipeline.edges.length}`,
    `- Validation findings: ${findings.length}`,
    `- Context risk: ${risk.score}/100`,
    '',
    '## Nodes By Type',
    '',
    bulletLines(countBy(pipeline.nodes.map((node) => node.type))),
    '',
    '## Validation Findings',
    '',
    findings.length ? findings.map((finding) => `- ${finding.severity.toUpperCase()} ${finding.ruleId}: ${finding.message}`).join('\n') : 'No validation findings.',
    '',
    '## Risk Score',
    '',
    `Score: ${risk.score}/100`,
    '',
    risk.reasons.length ? bulletLines(risk.reasons) : 'No risk reasons.',
    '',
    '## Tool Summary',
    '',
    toolSummary(pipeline),
    '',
    '## Artifact Boundaries',
    '',
    artifactSummary(pipeline),
    '',
    '## Recent Activity',
    '',
    activitySummary(activityEvents),
    ''
  ].join('\n');
}

export function renderActivityCsv(events: AgentFlowActivityEvent[]): string {
  const rows = [
    ['timestamp', 'session', 'node', 'phase', 'summary', 'tool', 'path', 'severity', 'tokens'],
    ...events.map((event) => [
      event.timestamp,
      event.sessionId,
      event.nodeId ?? '',
      event.phase,
      event.summary,
      event.toolName ?? '',
      event.artifactPath ?? event.nodeFile ?? '',
      event.severity ?? '',
      event.tokenEstimate === undefined ? '' : String(event.tokenEstimate)
    ])
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

function toolSummary(pipeline: AgentPipeline): string {
  const tools = new Map<string, number>();
  for (const node of pipeline.nodes) {
    if (node.type !== 'agent' && node.type !== 'prompt') continue;
    for (const tool of node.tools ?? []) tools.set(tool, (tools.get(tool) ?? 0) + 1);
  }
  if (!tools.size) return 'No tools configured.';
  return [...tools.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([tool, count]) => `- ${tool}: ${count} node${count === 1 ? '' : 's'}`)
    .join('\n');
}

function artifactSummary(pipeline: AgentPipeline): string {
  const lines: string[] = [];
  for (const node of pipeline.nodes) {
    if (node.type === 'artifact') lines.push(`- ${node.path}: artifact node`);
    if (node.type === 'agent') {
      for (const input of node.inputs ?? []) lines.push(`- ${input}: input for ${node.id}`);
      for (const output of node.outputs ?? []) lines.push(`- ${output}: output from ${node.id}`);
    }
    if (supportsArtifactUsages(node)) {
      for (const usage of node.artifactUsages ?? []) lines.push(`- ${usage.path}: ${usage.action} by ${node.id}`);
    }
  }
  return lines.length ? [...new Set(lines)].join('\n') : 'No artifact boundaries configured.';
}

function activitySummary(events: AgentFlowActivityEvent[]): string {
  if (!events.length) return 'No activity events.';
  return events.slice(-50).map((event) => {
    const target = event.artifactPath ?? event.nodeFile ?? event.nodeId ?? 'pipeline';
    return `- ${event.timestamp} ${event.phase} ${target}: ${event.summary}`;
  }).join('\n');
}

function countBy(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([value, count]) => `${value}: ${count}`);
}

function bulletLines(values: string[]): string {
  return values.length ? values.map((value) => `- ${value}`).join('\n') : 'None.';
}

function supportsArtifactUsages(node: PipelineNode): node is Extract<PipelineNode, { type: 'agent' | 'prompt' | 'instruction' | 'skill' }> {
  return node.type === 'agent' || node.type === 'prompt' || node.type === 'instruction' || node.type === 'skill';
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
