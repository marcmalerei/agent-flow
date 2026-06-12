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

function agent(id: string, label: string, description: string, x: number, y: number, options: Partial<AgentNode> = {}): AgentNode {
  return {
    id,
    type: 'agent',
    label,
    agentFile: `.github/agents/${id}.agent.md`,
    description,
    tools: options.tools ?? ['read', 'search'],
    calls: options.calls ?? [],
    inputs: options.inputs ?? [],
    outputs: options.outputs ?? [`.github/artifacts/results/${id}-result.md`],
    allowedSkills: options.allowedSkills ?? [],
    rules: options.rules ?? [`Complete the ${label.toLowerCase()} responsibility with minimal context.`],
    contextBudget: options.contextBudget ?? commonContextBudget,
    editRules: options.editRules ?? ['Do not refactor unrelated files.', 'Do not add dependencies unless explicitly requested.'],
    verificationRules: options.verificationRules ?? commonVerification,
    forbiddenChanges: options.forbiddenChanges ?? ['Do not modify unrelated production files.'],
    commandSafety: options.commandSafety,
    position: { x, y }
  };
}

export function createDefaultPipeline(): AgentPipeline {
  const nodes: PipelineNode[] = [
    {
      id: 'start-implementation',
      type: 'prompt',
      label: 'Start Implementation Prompt',
      promptFile: '.github/prompts/start-implementation.prompt.md',
      description: 'Starts the default Agent Flow implementation pipeline.',
      startAgent: 'router',
      tools: ['read', 'search'],
      workflow: ['Collect the request.', 'Run the router agent.', 'Follow generated artifact handoffs.'],
      constraints: ['Do not bypass artifact handoff files.', 'Do not make destructive changes without approval.'],
      requiredArtifacts: ['.github/artifacts/TASK_CONTEXT.md', '.github/artifacts/IMPLEMENTATION_PLAN.md'],
      definitionOfDone: ['Final review passes.', 'Required artifacts are written.'],
      position: { x: 40, y: 40 }
    },
    agent('router', 'Router', 'Routes the user request to context gathering and planning.', 80, 180, { calls: ['context'], outputs: ['.github/artifacts/ROUTING.md'] }),
    agent('context', 'Context', 'Gathers focused task context and writes a compact context artifact.', 260, 180, { inputs: ['.github/artifacts/ROUTING.md'], calls: ['planner'], outputs: ['.github/artifacts/TASK_CONTEXT.md'] }),
    agent('planner', 'Planner', 'Creates an implementation plan from task context.', 440, 180, { inputs: ['.github/artifacts/TASK_CONTEXT.md'], calls: ['task-splitter'], outputs: ['.github/artifacts/IMPLEMENTATION_PLAN.md'] }),
    agent('task-splitter', 'Task Splitter', 'Splits the plan into frontend and backend task artifacts.', 620, 180, { inputs: ['.github/artifacts/IMPLEMENTATION_PLAN.md'], calls: ['frontend', 'backend'], outputs: ['.github/artifacts/tasks/frontend.md', '.github/artifacts/tasks/backend.md'] }),
    agent('frontend', 'Frontend Agent', 'Implements frontend tasks with minimal context and focused tests.', 820, 80, { tools: ['read', 'search', 'edit', 'execute'], inputs: ['.github/artifacts/tasks/frontend.md'], outputs: ['.github/artifacts/results/frontend-result.md'], calls: ['frontend-review'], allowedSkills: ['ui-implementation', 'vitest-testing'], commandSafety: ['Run focused tests first.', 'Do not install dependencies without approval.'], rules: ['Read only the frontend task first.', 'Do not modify backend APIs.', 'Do not add dependencies.', 'Run focused tests first.'] }),
    agent('backend', 'Backend Agent', 'Implements backend tasks with minimal context and focused tests.', 820, 300, { tools: ['read', 'search', 'edit', 'execute'], inputs: ['.github/artifacts/tasks/backend.md'], outputs: ['.github/artifacts/results/backend-result.md'], calls: ['backend-review'], commandSafety: ['Run focused tests first.', 'Do not run destructive database commands.'] }),
    agent('frontend-review', 'Frontend Review', 'Reviews frontend changes without editing production files.', 1040, 80, { inputs: ['.github/artifacts/results/frontend-result.md'], outputs: ['.github/artifacts/reviews/frontend-review.md'], calls: ['integration'], tools: ['read', 'search'], editRules: ['Read-only review. Do not edit files.'] }),
    agent('backend-review', 'Backend Review', 'Reviews backend changes without editing production files.', 1040, 300, { inputs: ['.github/artifacts/results/backend-result.md'], outputs: ['.github/artifacts/reviews/backend-review.md'], calls: ['integration'], tools: ['read', 'search'], editRules: ['Read-only review. Do not edit files.'] }),
    agent('integration', 'Integration', 'Integrates reviewed frontend and backend results.', 1260, 190, { tools: ['read', 'search', 'edit', 'execute'], inputs: ['.github/artifacts/reviews/frontend-review.md', '.github/artifacts/reviews/backend-review.md'], outputs: ['.github/artifacts/results/integration-result.md'], calls: ['test'], commandSafety: ['Run integration checks only after reviewing artifacts.'] }),
    agent('test', 'Test', 'Runs focused validation and records failures for the fix agent.', 1460, 190, { tools: ['read', 'search', 'execute'], inputs: ['.github/artifacts/results/integration-result.md'], outputs: ['.github/artifacts/results/test-result.md'], calls: ['fix', 'docs'], commandSafety: ['Prefer package scripts and focused tests.', 'Do not run destructive commands.'] }),
    agent('fix', 'Fix If Needed', 'Applies bounded fixes from test results and returns to tests.', 1460, 390, { tools: ['read', 'search', 'edit', 'execute'], inputs: ['.github/artifacts/results/test-result.md'], outputs: ['.github/artifacts/results/fix-result.md'], calls: ['test'], commandSafety: ['Only fix failures documented in the test artifact.'] }),
    agent('docs', 'Docs', 'Updates documentation after tests pass.', 1660, 190, { tools: ['read', 'search', 'edit'], inputs: ['.github/artifacts/results/test-result.md'], outputs: ['.github/artifacts/results/docs-result.md'], calls: ['final-review'], editRules: ['Only edit documentation unless explicitly approved.'] }),
    agent('final-review', 'Final Review', 'Performs final read-only review and release checklist.', 1860, 190, { tools: ['read', 'search'], inputs: ['.github/artifacts/results/docs-result.md'], outputs: ['.github/artifacts/FINAL_REVIEW.md'], editRules: ['Read-only review. Do not edit files.'] }),
    { id: 'tests-green', type: 'gate', label: 'Tests Green?', description: 'Routes failures to fix and passing runs to docs.', condition: 'Tests pass without relevant failures.', trueBranch: 'docs', falseBranch: 'fix', maxIterations: 3, position: { x: 1460, y: 40 } },
    { id: 'ui-implementation', type: 'skill', label: 'UI Implementation Skill', description: 'Use for narrowly scoped UI implementation in existing project patterns.', skillFile: '.github/skills/ui-implementation/SKILL.md', argumentHint: 'component or UI area', activationCriteria: ['A task explicitly changes frontend UI.', 'Existing UI patterns need to be followed.'], doNotUseWhen: ['The task is backend-only.', 'No UI files are affected.'], procedure: ['Inspect the target component first.', 'Reuse existing styles and tests.', 'Run focused UI tests.'], resourceReferences: ['project UI components'], position: { x: 820, y: -110 } },
    { id: 'vitest-testing', type: 'skill', label: 'Vitest Testing Skill', description: 'Use for focused Vitest test creation and debugging.', skillFile: '.github/skills/vitest-testing/SKILL.md', argumentHint: 'test file or failing behavior', activationCriteria: ['A TypeScript unit test is needed.', 'A Vitest failure must be debugged.'], doNotUseWhen: ['The repository does not use Vitest.'], procedure: ['Find nearest existing test.', 'Add the smallest assertion that covers behavior.', 'Run the focused test command.'], resourceReferences: ['package scripts', 'existing test files'], position: { x: 1040, y: -110 } }
  ];

  const edges: PipelineEdge[] = [
    { id: 'prompt-to-router', from: 'start-implementation', to: 'router', kind: 'prompt' },
    { id: 'router-to-context', from: 'router', to: 'context', kind: 'flow' },
    { id: 'context-to-planner', from: 'context', to: 'planner', kind: 'artifact', artifact: '.github/artifacts/TASK_CONTEXT.md' },
    { id: 'planner-to-splitter', from: 'planner', to: 'task-splitter', kind: 'artifact', artifact: '.github/artifacts/IMPLEMENTATION_PLAN.md' },
    { id: 'splitter-to-frontend', from: 'task-splitter', to: 'frontend', kind: 'artifact', artifact: '.github/artifacts/tasks/frontend.md' },
    { id: 'splitter-to-backend', from: 'task-splitter', to: 'backend', kind: 'artifact', artifact: '.github/artifacts/tasks/backend.md' },
    { id: 'frontend-to-review', from: 'frontend', to: 'frontend-review', kind: 'artifact', artifact: '.github/artifacts/results/frontend-result.md' },
    { id: 'backend-to-review', from: 'backend', to: 'backend-review', kind: 'artifact', artifact: '.github/artifacts/results/backend-result.md' },
    { id: 'frontend-review-to-integration', from: 'frontend-review', to: 'integration', kind: 'artifact', artifact: '.github/artifacts/reviews/frontend-review.md' },
    { id: 'backend-review-to-integration', from: 'backend-review', to: 'integration', kind: 'artifact', artifact: '.github/artifacts/reviews/backend-review.md' },
    { id: 'integration-to-test', from: 'integration', to: 'test', kind: 'artifact', artifact: '.github/artifacts/results/integration-result.md' },
    { id: 'test-to-gate', from: 'test', to: 'tests-green', kind: 'gate' },
    { id: 'gate-to-fix', from: 'tests-green', to: 'fix', kind: 'gate', label: 'false' },
    { id: 'fix-to-test', from: 'fix', to: 'test', kind: 'artifact', artifact: '.github/artifacts/results/fix-result.md' },
    { id: 'gate-to-docs', from: 'tests-green', to: 'docs', kind: 'gate', label: 'true' },
    { id: 'docs-to-final-review', from: 'docs', to: 'final-review', kind: 'artifact', artifact: '.github/artifacts/results/docs-result.md' }
  ];

  return { version: PIPELINE_VERSION, name: 'Default Agent Pipeline', nodes, edges };
}
