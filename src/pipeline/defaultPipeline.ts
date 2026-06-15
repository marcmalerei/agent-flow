import { AgentNode, AgentPipeline, PipelineEdge, PipelineNode, PIPELINE_VERSION } from './types';

const commonContextBudget = [
  'Read only files listed in the task first.',
  'Do not scan broad folders.',
  'Do not load examples before inspecting existing project code.',
  'Load at most one additional file per iteration.',
  'Do not load unrelated skills.'
];

const commonVerification = [
  'Run the smallest relevant test command first.',
  'Run typecheck if production TypeScript changed.',
  'Use only relevant error lines from long logs.'
];

const readTool = 'read/readFile';
const searchTool = 'search/searchWorkspaceSymbols';
const editTool = 'edit/editFiles';
const executeTool = 'execute/run_in_terminal';
const defaultTools = [readTool, searchTool];

function toolsForAgent(options: Partial<AgentNode>): string[] {
  const tools = [...(options.tools ?? defaultTools)];
  if (((options.outputs?.length ?? 0) > 0 || options.artifactUsages?.some((usage) => usage.action === 'write' || usage.action === 'append')) && !tools.includes(editTool)) tools.push(editTool);
  if (((options.calls?.length ?? 0) > 0 || (options.handoffs?.length ?? 0) > 0) && !tools.includes('agent')) return ['agent', ...tools];
  return tools;
}

function labelFromId(id: string): string {
  return id.split('-').map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(' ');
}

function defaultHandoffs(calls: string[] | undefined): AgentNode['handoffs'] {
  if (!calls?.length) return undefined;
  return calls.map((target) => ({
    label: `Hand off to ${labelFromId(target)}`,
    agent: target,
    prompt: `Continue the pipeline as ${target}. Read the relevant input artifacts before making changes.`
  }));
}

function agent(id: string, _label: string, description: string, x: number, y: number, options: Partial<AgentNode> = {}): AgentNode {
  return {
    id,
    type: 'agent',
    label: id,
    agentFile: `.github/agents/${id}.agent.md`,
    description,
    tools: toolsForAgent(options),
    calls: options.calls ?? [],
    handoffs: options.handoffs ?? defaultHandoffs(options.calls),
    inputs: options.inputs ?? [],
    outputs: options.outputs ?? [`.github/artifacts/results/${id}-result.md`],
    allowedSkills: options.allowedSkills ?? [],
    rules: options.rules ?? [`Complete the ${id} responsibility with minimal context.`],
    contextBudget: options.contextBudget ?? commonContextBudget,
    editRules: options.editRules ?? ['Do not refactor unrelated files.', 'Do not add dependencies unless explicitly requested.'],
    verificationRules: options.verificationRules ?? commonVerification,
    forbiddenChanges: options.forbiddenChanges ?? ['Do not modify unrelated production files.'],
    commandSafety: options.commandSafety,
    position: { x, y }
  };
}

function artifact(path: string, x: number, y: number): PipelineNode {
  const fileName = path.split('/').pop() ?? path;
  const label = fileName.replace(/\.[^.]+$/, '').toLowerCase();
  return {
    id: `artifact-${path.replace(/^\.github\/artifacts\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}`,
    type: 'artifact',
    label,
    path,
    position: { x, y }
  };
}

export function createDefaultPipeline(): AgentPipeline {
  const requestArtifact = '.github/artifacts/request.md';
  const planArtifact = '.github/artifacts/plan.md';
  const resultArtifact = '.github/artifacts/result.md';
  const codingStandards = '.github/instructions/coding-standards.instructions.md';
  const testStrategy = '.github/instructions/test-strategy.instructions.md';
  const reviewChecklist = '.github/instructions/review-checklist.instructions.md';

  const nodes: PipelineNode[] = [
    {
      id: 'start-implementation',
      type: 'prompt',
      label: 'Start Implementation Prompt',
      promptFile: '.github/prompts/start-implementation.prompt.md',
      description: 'Starts the default Agent Flow implementation pipeline.',
      startAgent: 'router',
      tools: [readTool, searchTool, editTool],
      workflow: ['Capture the request in the request artifact.', 'Run the router agent.', 'Follow handoffs and keep artifacts current.'],
      constraints: ['Do not bypass artifact handoff files.', 'Keep each artifact concise.', 'Do not make destructive changes without approval.'],
      artifactUsages: [{ path: requestArtifact, action: 'write', instruction: 'Write the user request and known constraints to $artifact before handing off.' }],
      definitionOfDone: ['The result artifact contains implementation notes, validation results, and final review.'],
      position: { x: 40, y: 40 }
    },
    agent('router', 'Router', 'Turns the user request into a short routing brief and starts focused context gathering.', 80, 180, {
      inputs: [requestArtifact],
      outputs: [planArtifact],
      calls: ['context'],
      rules: ['Extract the user goal, constraints, and likely files.', 'Keep the plan artifact short enough for the next agent to scan quickly.']
    }),
    agent('context', 'Context', 'Reads the routing brief, inspects only relevant files, and enriches the plan.', 300, 180, {
      inputs: [planArtifact],
      outputs: [planArtifact],
      calls: ['implementer'],
      instructionRefs: [{ target: codingStandards, instruction: 'Apply $instruction while deciding which project conventions matter.' }],
      rules: ['Inspect only files needed to plan the change.', 'Update the plan artifact with concrete file paths and risks.']
    }),
    agent('implementer', 'Implementer', 'Makes the scoped code or documentation change and records what changed.', 520, 180, {
      tools: [readTool, searchTool, editTool, executeTool],
      inputs: [planArtifact],
      outputs: [resultArtifact],
      calls: ['reviewer'],
      instructionRefs: [
        { target: codingStandards, instruction: 'Follow $instruction for code style and scope.' },
        { target: testStrategy, instruction: 'Use $instruction before choosing validation commands.' }
      ],
      commandSafety: ['Run the smallest relevant test command first.', 'Do not install dependencies without approval.', 'Do not run destructive commands.'],
      rules: ['Implement only the planned change.', 'Write changed files and validation commands to the result artifact.']
    }),
    agent('reviewer', 'Reviewer', 'Reviews the implementation result and records blocking findings or approval.', 740, 180, {
      inputs: [resultArtifact],
      outputs: [resultArtifact],
      calls: ['final'],
      instructionRefs: [
        { target: testStrategy, instruction: 'Check validation quality against $instruction.' },
        { target: reviewChecklist, instruction: 'Use $instruction for the review order.' }
      ],
      editRules: ['Only update the result artifact with review findings.', 'Do not edit production files during review.'],
      rules: ['List blocking findings first.', 'Record residual risk if no blocking issue remains.']
    }),
    agent('final', 'Final', 'Prepares the final summary and confirms the result artifact is complete.', 960, 180, {
      inputs: [resultArtifact],
      outputs: [resultArtifact],
      instructionRefs: [{ target: reviewChecklist, instruction: 'Use $instruction before finalizing the response.' }],
      editRules: ['Only update the result artifact and final response notes.'],
      rules: ['Summarize changes, tests, and open risks.', 'Do not claim validation that was not run.']
    }),
    artifact(requestArtifact, 140, 340),
    artifact(planArtifact, 400, 340),
    artifact(resultArtifact, 720, 340),
    {
      id: 'coding-standards',
      type: 'instruction',
      label: 'coding standards',
      instructionFile: codingStandards,
      description: 'Project coding and scope rules.',
      applyTo: 'src/**/*',
      rules: ['Prefer existing project patterns.', 'Keep changes scoped to the requested behavior.', 'Avoid unrelated refactors.'],
      position: { x: 300, y: 20 }
    },
    {
      id: 'test-strategy',
      type: 'instruction',
      label: 'test strategy',
      instructionFile: testStrategy,
      description: 'Validation rules for implementation agents.',
      applyTo: 'test/**/*',
      rules: ['Run focused tests before broader checks.', 'Report commands and relevant failures.', 'Do not hide skipped validation.'],
      position: { x: 520, y: 20 }
    },
    {
      id: 'review-checklist',
      type: 'instruction',
      label: 'review checklist',
      instructionFile: reviewChecklist,
      description: 'Review and final response checklist.',
      applyTo: '.github/agents/**/*.agent.md',
      rules: ['Find correctness issues before style notes.', 'Mention missing tests or residual risk.', 'Keep final summaries concise.'],
      position: { x: 740, y: 20 }
    }
  ];

  const edges: PipelineEdge[] = [
    { id: 'prompt-to-router', from: 'start-implementation', to: 'router', kind: 'prompt' },
    { id: 'router-to-context', from: 'router', to: 'context', kind: 'artifact', artifact: planArtifact },
    { id: 'context-to-implementer', from: 'context', to: 'implementer', kind: 'artifact', artifact: planArtifact },
    { id: 'implementer-to-reviewer', from: 'implementer', to: 'reviewer', kind: 'artifact', artifact: resultArtifact },
    { id: 'reviewer-to-final', from: 'reviewer', to: 'final', kind: 'artifact', artifact: resultArtifact }
  ];

  return { version: PIPELINE_VERSION, name: 'Default Agent Pipeline', nodes, edges };
}
