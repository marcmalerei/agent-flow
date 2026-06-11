import { AgentPipeline, RiskScore } from './types';
import { findCycles } from './validator';

export function calculateRiskScore(pipeline: AgentPipeline, options: { copilotInstructionsLines?: number } = {}): RiskScore {
  let score = 0;
  const reasons: string[] = [];
  const alwaysOnLines = options.copilotInstructionsLines ?? 0;
  if (alwaysOnLines > 200) { score += 15; reasons.push(`copilot-instructions.md has ${alwaysOnLines} lines`); }
  const broadApply = pipeline.nodes.filter((node) => node.type === 'instruction' && Boolean(node.applyTo && ['**/*', '**/*.md'].includes(node.applyTo))).length;
  if (broadApply) { score += broadApply * 8; reasons.push(`${broadApply} instructions use broad applyTo patterns`); }
  const runCommandAgents = pipeline.nodes.filter((node) => node.type === 'agent' && (node.tools?.includes('execute') || node.tools?.includes('runCommands'))).length;
  if (runCommandAgents) { score += runCommandAgents * 6; reasons.push(`${runCommandAgents} agents can run commands`); }
  const genericSkills = pipeline.nodes.filter((node) => node.type === 'skill' && (!node.description || /general|helpful|useful/i.test(node.description))).length;
  if (genericSkills) { score += genericSkills * 7; reasons.push(`${genericSkills} skills have generic descriptions`); }
  const embeddedExamples = pipeline.nodes.filter((node) => node.type === 'skill' && node.procedure?.some((step) => /example|sample/i.test(step))).length;
  if (embeddedExamples) { score += embeddedExamples * 5; reasons.push(`${embeddedExamples} skills include embedded examples or samples`); }
  const missingBudget = pipeline.nodes.filter((node) => node.type === 'agent' && !node.contextBudget?.length).length;
  if (missingBudget) { score += missingBudget * 5; reasons.push(`${missingBudget} agents are missing context budget rules`); }
  const missingArtifacts = pipeline.nodes.filter((node) => node.type === 'agent' && (!node.inputs?.length || !node.outputs?.length)).length;
  if (missingArtifacts) { score += missingArtifacts * 4; reasons.push(`${missingArtifacts} agents are missing explicit input or output artifact boundaries`); }
  if (pipeline.nodes.length > 15) { score += Math.min(15, pipeline.nodes.length - 15); reasons.push(`${pipeline.nodes.length} nodes increase context coordination overhead`); }
  const cycles = findCycles(pipeline.nodes, pipeline.edges);
  if (cycles.length) { score += cycles.length * 10; reasons.push(`${cycles.length} cycles exist in the pipeline`); }
  return { score: Math.min(100, score), reasons };
}
