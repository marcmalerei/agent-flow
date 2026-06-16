import { AgentPipeline, PipelineNode, ValidationFinding } from './types';
import { normalizePipelineAgentReferences, resolveAgentReference, stripYamlQuotes } from './referenceResolver';

type FindingMetadata = Partial<Omit<ValidationFinding, 'severity' | 'ruleId' | 'message' | 'nodeId'>>;

function finding(severity: ValidationFinding['severity'], ruleId: string, message: string, nodeId?: string, metadata: FindingMetadata = {}): ValidationFinding {
  const defaultActions = nodeId ? [{ kind: 'focusNode' as const, label: 'Focus node', nodeId }] : [];
  const filePath = metadata.entity?.filePath;
  const fileActions = filePath ? [{ kind: 'openFile' as const, label: 'Open file', filePath }] : [];
  return {
    severity,
    ruleId,
    message,
    nodeId,
    ...metadata,
    actions: metadata.actions ?? [...defaultActions, ...fileActions]
  };
}

function hasBroadTool(tools: string[] | undefined): boolean {
  return Boolean((tools?.includes('edit') || tools?.includes('editFiles')) && (tools.includes('execute') || tools.includes('runCommands')));
}

export function validatePipeline(pipeline: AgentPipeline): ValidationFinding[] {
  pipeline = normalizePipelineAgentReferences(pipeline);
  const findings: ValidationFinding[] = [];
  const nodes = new Map(pipeline.nodes.map((node) => [node.id, node]));
  const writes = new Map<string, string[]>();
  const reads = new Map<string, string[]>();

  for (const edge of pipeline.edges) {
    if (!nodes.has(edge.from)) findings.push(finding('error', 'unknown-edge-from', `Edge ${edge.id} starts at unknown node \`${edge.from}\`.`));
    if (!nodes.has(edge.to)) findings.push(finding('error', 'unknown-edge-to', `Edge ${edge.id} ends at unknown node \`${edge.to}\`.`));
  }

  for (const node of pipeline.nodes) {
    if (node.type === 'agent') {
      for (const call of node.calls ?? []) {
        if (!resolveAgentReference(call, pipeline.nodes)) findings.push(finding('error', 'unknown-subagent', `${node.id}.agent.md references subagent \`${stripYamlQuotes(call)}\`, but it does not exist.`, node.id));
      }
      if (!node.outputs?.length) findings.push(finding('warning', 'agent-no-output', `${nodeFileFor(node)} has no output artifact.`, node.id, {
        title: 'Missing output artifact',
        entity: { kind: 'node', id: node.id, label: node.label, filePath: nodeFileFor(node) },
        why: 'Without an explicit output artifact, downstream agents cannot reliably consume this node result.',
        suggestedFix: 'Add or select an output artifact so downstream agents can consume this result.',
        actions: [
          { kind: 'focusNode', label: 'Focus node', nodeId: node.id, sectionId: 'artifacts' },
          { kind: 'openInspectorSection', label: 'Open artifacts', nodeId: node.id, sectionId: 'artifacts' },
          { kind: 'openFile', label: 'Open file', filePath: nodeFileFor(node) },
          { kind: 'quickFix', label: 'Apply quick fix', quickFixId: 'create-output-artifact', nodeId: node.id, sectionId: 'artifacts' }
        ]
      }));
      for (const input of node.inputs ?? []) addArtifactBoundary(reads, input, node.id);
      for (const output of node.outputs ?? []) addArtifactBoundary(writes, output, node.id);
      recordArtifactUsages(node, reads, writes);
      if (hasBroadTool(node.tools)) findings.push(finding('risk', 'broad-agent-tools', `${node.id}.agent.md can run commands and edit files. Consider command restrictions or hooks.`, node.id));
      if ((node.tools?.includes('execute') || node.tools?.includes('runCommands')) && !node.commandSafety?.length) findings.push(finding('warning', 'missing-command-safety', `${node.id}.agent.md can execute commands but has no command safety policy.`, node.id));
      if (node.id.includes('docs') && (node.tools?.includes('edit') || node.tools?.includes('editFiles')) && !node.editRules?.some((rule) => /only edit documentation|docs only/i.test(rule))) findings.push(finding('warning', 'docs-edits-production', `${node.id}.agent.md can edit files without a documentation-only rule.`, node.id));
      if (/review/i.test(node.id + node.label) && (node.tools?.includes('edit') || node.tools?.includes('editFiles'))) findings.push(finding('warning', 'review-can-edit', `${node.id}.agent.md is a review agent but can edit files.`, node.id));
    }
    if (node.type === 'prompt') {
      if (node.startAgent && !resolveAgentReference(node.startAgent, pipeline.nodes)) findings.push(finding('error', 'prompt-unknown-agent', `${node.id}.prompt.md references unknown start agent \`${stripYamlQuotes(node.startAgent)}\`.`, node.id));
      if (!node.constraints?.length) findings.push(finding('warning', 'prompt-no-constraints', `${node.id}.prompt.md has no constraints or non-goals.`, node.id));
      for (const artifact of node.requiredArtifacts ?? []) addArtifactBoundary(reads, artifact, node.id);
      recordArtifactUsages(node, reads, writes);
    }
    if (node.type === 'instruction') {
      if (node.applyTo === '**/*') findings.push(instructionScopeFinding('broad-apply-to', node, '**/*', 'Broad instruction scope', 'This instruction applies to every file in the workspace and can unintentionally affect unrelated agent context.'));
      if (node.applyTo === '**/*.md') findings.push(instructionScopeFinding('markdown-apply-to', node, '**/*.md', 'Broad Markdown instruction scope', 'This instruction applies to all Markdown files, including agent, prompt, instruction, and skill files.'));
      for (const artifact of node.requiredArtifacts ?? []) addArtifactBoundary(reads, artifact, node.id);
      recordArtifactUsages(node, reads, writes);
    }
    if (node.type === 'skill') {
      if (!node.activationCriteria?.length) findings.push(finding('warning', 'skill-no-activation', `${node.id} skill has no activation criteria.`, node.id));
      if (!node.description || /^(useful|helpful|general|does many things)\.?$/i.test(node.description.trim())) findings.push(finding('risk', 'generic-skill-description', `${node.id} skill has a generic description.`, node.id));
      for (const artifact of node.requiredArtifacts ?? []) addArtifactBoundary(reads, artifact, node.id);
      recordArtifactUsages(node, reads, writes);
    }
    if (node.type === 'artifact') {
      if (!node.path.startsWith('.github/artifacts/')) findings.push(finding('warning', 'artifact-outside-artifacts', `${node.id} artifact is outside .github/artifacts.`, node.id));
    }
  }

  for (const [artifact, consumers] of reads) {
    if (!writes.has(artifact)) findings.push(finding('warning', 'artifact-read-never-written', `Artifact \`${artifact}\` is read by ${consumers.join(', ')} but never written.`));
  }
  for (const [artifact, producers] of writes) {
    if (!reads.has(artifact)) findings.push(finding('info', 'artifact-written-never-consumed', `Artifact \`${artifact}\` is written by ${producers.join(', ')} but never consumed.`));
  }

  for (const cycle of findCycles(pipeline.nodes, pipeline.edges)) {
    const hasBoundedGate = cycle.some((id) => {
      const node = nodes.get(id);
      return node?.type === 'gate' && typeof node.maxIterations === 'number' && node.maxIterations > 0;
    });
    if (!hasBoundedGate) findings.push(finding('warning', 'unbounded-cycle', `${cycle.join(' -> ')} form an unbounded cycle that needs a max iteration count.`));
  }

  return findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.ruleId.localeCompare(b.ruleId));
}

function instructionScopeFinding(ruleId: string, node: Extract<PipelineNode, { type: 'instruction' }>, pattern: string, title: string, why: string): ValidationFinding {
  const filePath = nodeFileFor(node);
  return finding('warning', ruleId, `${filePath} uses applyTo "${pattern}".`, node.id, {
    title,
    entity: { kind: 'file', id: filePath, label: node.label, filePath },
    why,
    suggestedFix: 'Narrow applyTo to the file patterns that should receive this instruction.',
    details: { pattern },
    actions: [
      { kind: 'focusNode', label: 'Focus node', nodeId: node.id, sectionId: 'context' },
      { kind: 'openInspectorSection', label: 'Open context', nodeId: node.id, sectionId: 'context' },
      { kind: 'openFile', label: 'Open file', filePath }
    ]
  });
}

function nodeFileFor(node: PipelineNode): string {
  if (node.type === 'agent') return node.agentFile ?? `.github/agents/${node.id}.agent.md`;
  if (node.type === 'prompt') return node.promptFile ?? `.github/prompts/${node.id}.prompt.md`;
  if (node.type === 'instruction') return node.instructionFile ?? `.github/instructions/${node.id}.instructions.md`;
  if (node.type === 'skill') return node.skillFile ?? `.github/skills/${node.id}/SKILL.md`;
  if (node.type === 'role') return node.roleFile ?? `.github/roles/${node.id}.md`;
  if (node.type === 'artifact') return node.path;
  return node.id;
}

function addArtifactBoundary(map: Map<string, string[]>, artifact: string, nodeId: string): void {
  map.set(artifact, [...(map.get(artifact) ?? []), nodeId]);
}

function recordArtifactUsages(node: PipelineNode, reads: Map<string, string[]>, writes: Map<string, string[]>): void {
  if (!('artifactUsages' in node)) return;
  for (const usage of node.artifactUsages ?? []) {
    const target = usage.action === 'write' || usage.action === 'append' ? writes : reads;
    addArtifactBoundary(target, usage.path, node.id);
  }
}

function severityRank(severity: ValidationFinding['severity']): number {
  return { error: 0, warning: 1, risk: 2, info: 3 }[severity];
}

export function findCycles(nodes: PipelineNode[], edges: { from: string; to: string }[]): string[][] {
  const graph = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) graph.get(edge.from)?.push(edge.to);
  const cycles: string[][] = [];
  const stack: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function dfs(id: string) {
    if (visiting.has(id)) {
      const index = stack.indexOf(id);
      if (index >= 0) cycles.push([...stack.slice(index), id]);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id); stack.push(id);
    for (const next of graph.get(id) ?? []) dfs(next);
    stack.pop(); visiting.delete(id); visited.add(id);
  }
  for (const node of nodes) dfs(node.id);
  return dedupeCycles(cycles);
}

function dedupeCycles(cycles: string[][]): string[][] {
  const seen = new Set<string>();
  return cycles.filter((cycle) => {
    const key = [...new Set(cycle)].sort().join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
