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
const reportActivityTool = 'agentflow_report_activity';
const completeNodeTool = 'agentflow_complete_node';
const defaultTools = [readTool, searchTool, reportActivityTool, completeNodeTool];

export interface DefaultPipelineDemoStep {
  action: string;
  command?: 'agentflow.createDefaultPipeline' | 'agentflow.playDemoActivity';
  expectedOutcome: string;
  focusNodeId?: string;
  id: string;
  title: string;
}

function toolsForAgent(options: Partial<AgentNode>): string[] {
  const tools = [...(options.tools ?? defaultTools)];
  if (((options.outputs?.length ?? 0) > 0 || options.artifactUsages?.some((usage) => usage.action === 'write' || usage.action === 'append')) && !tools.includes(editTool)) tools.push(editTool);
  if (((options.calls?.length ?? 0) > 0 || (options.handoffs?.length ?? 0) > 0) && !tools.includes('agent')) return ['agent', ...tools];
  return tools;
}

function labelFromId(id: string): string {
  return id.replace(/-/g, ' ');
}

function defaultHandoffs(calls: string[] | undefined): AgentNode['handoffs'] {
  if (!calls?.length) return undefined;
  return calls.map((target) => ({
    label: `hand off to ${labelFromId(target)}`,
    agent: target,
    prompt: `Continue the pipeline as ${target}. Read the relevant input artifacts before making changes.`
  }));
}

function agent(id: string, _label: string, description: string, x: number, y: number, options: Partial<AgentNode> = {}): AgentNode {
  const inputs = options.inputs ?? [];
  const outputs = options.outputs ?? [`.github/artifacts/results/${id}-result.md`];
  return {
    id,
    type: 'agent',
    label: id,
    agentFile: `.github/agents/${id}.agent.md`,
    description,
    tools: toolsForAgent(options),
    calls: options.calls ?? [],
    handoffs: options.handoffs ?? defaultHandoffs(options.calls),
    inputs,
    outputs,
    artifactUsages: options.artifactUsages ?? [
      ...inputs.map((path) => ({ path, action: 'read' as const, instruction: `Read $artifact before starting this step.` })),
      ...outputs.map((path) => ({ path, action: 'write' as const, instruction: `Write this step's result to $artifact.` }))
    ],
    allowedSkills: options.allowedSkills ?? [],
    rules: options.rules ?? [`Complete the ${id} responsibility with minimal context.`],
    contextBudget: options.contextBudget ?? commonContextBudget,
    editRules: options.editRules ?? ['Do not refactor unrelated files.', 'Do not add dependencies unless explicitly requested.'],
    verificationRules: options.verificationRules ?? commonVerification,
    forbiddenChanges: options.forbiddenChanges ?? ['Do not modify unrelated production files.'],
    commandSafety: options.commandSafety,
    instructionRefs: options.instructionRefs,
    roleRefs: options.roleRefs,
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
  const projectGuidelines = '.github/instructions/project-guidelines.instructions.md';
  const testStrategy = '.github/instructions/test-strategy.instructions.md';

  const nodes: PipelineNode[] = [
    {
      id: 'start-implementation',
      type: 'prompt',
      label: 'start implementation prompt',
      promptFile: '.github/prompts/start-implementation.prompt.md',
      description: 'Starts a small Agent Flow implementation pipeline.',
      startAgent: 'router',
      tools: [readTool, searchTool, editTool, reportActivityTool, completeNodeTool],
      workflow: ['Capture the request in the request artifact.', 'Route to the implementer.', 'Review once and use the fixer only when needed.'],
      constraints: ['Do not bypass artifact handoff files.', 'Keep each artifact concise.', 'Do not make destructive changes without approval.'],
      artifactUsages: [{ path: requestArtifact, action: 'write', instruction: 'Write the user request and known constraints to $artifact before handing off.' }],
      definitionOfDone: ['The result artifact contains implementation notes, validation results, and review outcome.'],
      position: { x: 40, y: 40 }
    },
    agent('router', 'Router', 'Turns the user request into a short implementation brief.', 80, 180, {
      inputs: [requestArtifact],
      outputs: [planArtifact],
      handoffs: [{ label: 'hand off to implementer', agent: 'implementer', prompt: 'Implement the scoped change using the brief.' }],
      instructionRefs: [{ target: projectGuidelines, instruction: 'Apply $instruction while deciding scope and file targets.' }],
      rules: ['Extract the user goal, constraints, likely files, and validation needs.', 'Keep the plan artifact short enough for the next agent to scan quickly.']
    }),
    agent('implementer', 'Implementer', 'Makes the scoped code or documentation change and records what changed.', 520, 180, {
      tools: [readTool, searchTool, editTool, executeTool, reportActivityTool, completeNodeTool],
      inputs: [planArtifact],
      outputs: [resultArtifact],
      handoffs: [{ label: 'hand off to reviewer', agent: 'reviewer', prompt: 'Review the implementation result and validation notes.' }],
      instructionRefs: [
        { target: projectGuidelines, instruction: 'Follow $instruction for code style and scope.' },
        { target: testStrategy, instruction: 'Use $instruction before choosing validation commands.' }
      ],
      commandSafety: ['Run the smallest relevant test command first.', 'Do not install dependencies without approval.', 'Do not run destructive commands.'],
      rules: ['Implement only the planned change.', 'Write changed files and validation commands to the result artifact.']
    }),
    agent('reviewer', 'Reviewer', 'Reviews the result and either approves it or routes focused repair work.', 740, 180, {
      inputs: [resultArtifact],
      outputs: [resultArtifact],
      handoffs: [{ label: 'hand off to fixer', agent: 'fixer', prompt: 'Fix only blocking review findings recorded in the result artifact.' }],
      instructionRefs: [{ target: testStrategy, instruction: 'Check validation quality against $instruction.' }],
      editRules: ['Only update the result artifact with review findings.', 'Do not edit production files during review.'],
      rules: ['List blocking findings first.', 'Record residual risk if no blocking issue remains.']
    }),
    agent('fixer', 'Fixer', 'Applies the smallest repair for blocking review findings.', 960, 180, {
      tools: [readTool, searchTool, editTool, executeTool, reportActivityTool, completeNodeTool],
      inputs: [resultArtifact],
      outputs: [resultArtifact],
      instructionRefs: [
        { target: projectGuidelines, instruction: 'Keep the repair scoped by $instruction.' },
        { target: testStrategy, instruction: 'Re-run only the validation required by $instruction.' }
      ],
      commandSafety: ['Run focused checks for the changed files.', 'Do not broaden the fix without routing back to review.'],
      rules: ['Fix only blocking review findings.', 'Append repair notes and validation results to the result artifact.']
    }),
    { id: 'router-handoff-hand-off-to-implementer', type: 'handoff', label: 'hand off to implementer', sourceAgent: 'router', targetAgent: 'implementer', prompt: 'Implement the scoped change using the brief.', position: { x: 190, y: 180 } },
    { id: 'implementer-handoff-hand-off-to-reviewer', type: 'handoff', label: 'hand off to reviewer', sourceAgent: 'implementer', targetAgent: 'reviewer', prompt: 'Review the implementation result and validation notes.', position: { x: 630, y: 180 } },
    { id: 'reviewer-handoff-hand-off-to-fixer', type: 'handoff', label: 'hand off to fixer', sourceAgent: 'reviewer', targetAgent: 'fixer', prompt: 'Fix only blocking review findings recorded in the result artifact.', position: { x: 850, y: 180 } },
    artifact(requestArtifact, 140, 340),
    artifact(planArtifact, 400, 340),
    artifact(resultArtifact, 720, 340),
    {
      id: 'project-guidelines',
      type: 'instruction',
      label: 'project guidelines',
      instructionFile: projectGuidelines,
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
    }
  ];

  const edges: PipelineEdge[] = [
    { id: 'prompt-to-router', from: 'start-implementation', to: 'router', kind: 'prompt' },
    { id: 'router-handoff-node-router-handoff-hand-off-to-implementer', from: 'router', to: 'router-handoff-hand-off-to-implementer', kind: 'handoff', label: 'hand off to implementer' },
    { id: 'implementer-handoff-node-implementer-handoff-hand-off-to-reviewer', from: 'implementer', to: 'implementer-handoff-hand-off-to-reviewer', kind: 'handoff', label: 'hand off to reviewer' },
    { id: 'reviewer-handoff-node-reviewer-handoff-hand-off-to-fixer', from: 'reviewer', to: 'reviewer-handoff-hand-off-to-fixer', kind: 'handoff', label: 'hand off to fixer' }
  ];

  return { version: PIPELINE_VERSION, name: 'default agent pipeline', nodes, edges };
}

export function createDefaultPipelineDemoScript(): DefaultPipelineDemoStep[] {
  return [
    {
      id: 'create-default-pipeline',
      title: 'Create the guided pipeline',
      command: 'agentflow.createDefaultPipeline',
      action: 'Run Agent Flow: Create Default Pipeline in a fresh workspace.',
      expectedOutcome: 'The start prompt, router, implementer, reviewer, fixer, three artifacts, and two instructions appear without critical diagnostics.'
    },
    {
      id: 'read-overview',
      title: 'Read the whole workflow at once',
      focusNodeId: 'start-implementation',
      action: 'Fit the graph and scan the prompt, handoff, artifact, and instruction edge types.',
      expectedOutcome: 'The full default pipeline fits in one overview and every resulting edge teaches prompt start, handoff, read/write artifact flow, or reference context.'
    },
    {
      id: 'create-context-node',
      title: 'Show node creation',
      action: 'Use Add Node for node creation and place a new instruction or agent near the implementer lane.',
      expectedOutcome: 'The new node appears in the same compact visual grammar and can be selected without hiding the default pipeline story.'
    },
    {
      id: 'edit-reference',
      title: 'Show reference editing',
      focusNodeId: 'implementer',
      action: 'Select implementer and use reference editing to attach project guidelines, test strategy, or the result artifact.',
      expectedOutcome: 'The inspector previews the write target and the graph shows the resulting edges for the edited reference.'
    },
    {
      id: 'replay-demo-activity',
      title: 'Replay activity',
      command: 'agentflow.playDemoActivity',
      focusNodeId: 'router',
      action: 'Run Agent Flow: Play Demo Activity after the graph is visible.',
      expectedOutcome: 'Temporary activity badges and handoff activity explain the route without changing the graph layout.'
    }
  ];
}
