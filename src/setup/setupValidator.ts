import { ActivitySourceRuntimeState } from '../activity/sources';
import { AgentPipeline } from '../pipeline/types';

export type SetupCheckSeverity = 'ok' | 'info' | 'warning' | 'error';
export type SetupFixAction = 'openSettings' | 'createDefaultPipeline' | 'openDocs';

export interface SetupCheck {
  id: string;
  category: 'vscode' | 'workspace' | 'tools' | 'activity';
  severity: SetupCheckSeverity;
  title: string;
  detail: string;
  fix?: SetupFixAction;
}

export interface SetupValidationInput {
  vscodeVersion: string;
  minimumVscodeVersion: string;
  hasLanguageModelToolApi: boolean;
  workspace?: {
    root: string;
    existingPaths: string[];
    pipeline?: AgentPipeline;
  };
  registeredTools: string[];
  activitySources: ActivitySourceRuntimeState[];
}

export interface SetupValidationReport {
  generatedAt: string;
  checks: SetupCheck[];
  availableTools: string[];
  unavailableTools: string[];
  summary: {
    errors: number;
    warnings: number;
    ok: number;
  };
}

export function buildSetupValidationReport(input: SetupValidationInput, now = new Date()): SetupValidationReport {
  const checks: SetupCheck[] = [];
  checks.push(versionCheck(input.vscodeVersion, input.minimumVscodeVersion));
  checks.push({
    id: 'vscode.lm-tools-api',
    category: 'vscode',
    severity: input.hasLanguageModelToolApi ? 'ok' : 'error',
    title: 'Language model tool API',
    detail: input.hasLanguageModelToolApi
      ? 'VS Code exposes the language model tool API required for Agent Flow activity tools.'
      : 'This VS Code build does not expose language model tool registration. Agent Flow activity tools cannot be registered.',
    fix: input.hasLanguageModelToolApi ? undefined : 'openDocs'
  });

  checks.push(...workspaceChecks(input.workspace));
  const toolMapping = toolChecks(input.workspace?.pipeline, input.registeredTools);
  checks.push(...toolMapping.checks);
  checks.push(...activityChecks(input.activitySources));

  const errors = checks.filter((check) => check.severity === 'error').length;
  const warnings = checks.filter((check) => check.severity === 'warning').length;
  const ok = checks.filter((check) => check.severity === 'ok').length;
  return {
    generatedAt: now.toISOString(),
    checks,
    availableTools: [...input.registeredTools].sort((a, b) => a.localeCompare(b)),
    unavailableTools: toolMapping.unavailableTools,
    summary: { errors, warnings, ok }
  };
}

export function renderSetupValidationReport(report: SetupValidationReport): string {
  const byCategory = groupBy(report.checks, (check) => check.category);
  return [
    '# Agent Flow Setup Check',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Summary',
    '',
    `- Errors: ${report.summary.errors}`,
    `- Warnings: ${report.summary.warnings}`,
    `- Passing checks: ${report.summary.ok}`,
    '',
    ...renderCategory('VS Code', byCategory.get('vscode') ?? []),
    ...renderCategory('Workspace', byCategory.get('workspace') ?? []),
    ...renderCategory('Activity Sources', byCategory.get('activity') ?? []),
    ...renderCategory('Tool Checks', byCategory.get('tools') ?? []),
    '## Tool Availability',
    '',
    '### Registered Tools',
    '',
    report.availableTools.length ? report.availableTools.map((tool) => `- \`${tool}\``).join('\n') : 'No registered language model tools reported by VS Code.',
    '',
    '### Selected But Unavailable',
    '',
    report.unavailableTools.length ? report.unavailableTools.map((tool) => `- \`${tool}\``).join('\n') : 'No unavailable selected tools.',
    ''
  ].join('\n');
}

function versionCheck(version: string, minimum: string): SetupCheck {
  const supported = compareVersions(version, minimum) >= 0;
  return {
    id: 'vscode.version',
    category: 'vscode',
    severity: supported ? 'ok' : 'error',
    title: 'VS Code version',
    detail: supported
      ? `VS Code ${version} satisfies Agent Flow's minimum ${minimum}.`
      : `VS Code ${version} is older than Agent Flow's minimum ${minimum}. Update VS Code before relying on live activity tools.`,
    fix: supported ? undefined : 'openDocs'
  };
}

function workspaceChecks(workspace: SetupValidationInput['workspace']): SetupCheck[] {
  if (!workspace) {
    return [{
      id: 'workspace.open-folder',
      category: 'workspace',
      severity: 'error',
      title: 'Workspace folder',
      detail: 'Open a workspace folder so Agent Flow can scan .github customization files.',
      fix: 'openDocs'
    }];
  }
  const paths = new Set(workspace.existingPaths.map(normalizePath));
  const checks: SetupCheck[] = [
    folderCheck(paths, '.github/agents', 'workspace.agents-folder', 'Agent folder', 'Agent files live in .github/agents.', 'error'),
    folderCheck(paths, '.github/prompts', 'workspace.prompts-folder', 'Prompt folder', 'Prompt files live in .github/prompts.', 'error'),
    folderCheck(paths, '.github/instructions', 'workspace.instructions-folder', 'Instruction folder', 'Instruction files live in .github/instructions.', 'error'),
    folderCheck(paths, '.github/artifacts', 'workspace.artifacts-folder', 'Artifact folder', 'Artifact files live in .github/artifacts.', 'warning')
  ];
  const hasPipelineFiles = [...paths].some((item) => /^\.github\/(agents|prompts|instructions|skills|roles|artifacts)\//.test(item));
  checks.push({
    id: 'workspace.pipeline-files',
    category: 'workspace',
    severity: hasPipelineFiles ? 'ok' : 'warning',
    title: 'Pipeline files',
    detail: hasPipelineFiles
      ? `Agent Flow can infer ${workspace.pipeline?.nodes.length ?? 'existing'} pipeline nodes from this workspace.`
      : 'No Agent Flow-compatible customization files were found. Create the default pipeline or add .github customization files.',
    fix: hasPipelineFiles ? undefined : 'createDefaultPipeline'
  });
  return checks;
}

function folderCheck(paths: Set<string>, folder: string, id: string, title: string, detail: string, missingSeverity: SetupCheckSeverity): SetupCheck {
  const exists = paths.has(folder);
  return {
    id,
    category: 'workspace',
    severity: exists ? 'ok' : missingSeverity,
    title,
    detail: exists ? `${folder} exists.` : `${detail} Missing ${folder}.`,
    fix: exists ? undefined : 'createDefaultPipeline'
  };
}

function toolChecks(pipeline: AgentPipeline | undefined, registeredTools: string[]): { checks: SetupCheck[]; unavailableTools: string[] } {
  const selected = new Set<string>();
  for (const node of pipeline?.nodes ?? []) {
    if (node.type !== 'agent' && node.type !== 'prompt') continue;
    for (const tool of node.tools ?? []) selected.add(tool);
  }
  const available = new Set(registeredTools);
  const unavailableTools = [...selected].filter((tool) => !available.has(tool)).sort((a, b) => a.localeCompare(b));
  const checks: SetupCheck[] = [{
    id: 'tools.registered',
    category: 'tools',
    severity: registeredTools.length ? 'ok' : 'warning',
    title: 'Registered language model tools',
    detail: registeredTools.length
      ? `VS Code reports ${registeredTools.length} registered language model tool${registeredTools.length === 1 ? '' : 's'}.`
      : 'VS Code reported no registered language model tools. Tool selection cannot be validated.',
    fix: registeredTools.length ? undefined : 'openDocs'
  }];
  checks.push({
    id: 'tools.unavailable',
    category: 'tools',
    severity: unavailableTools.length ? 'warning' : 'ok',
    title: 'Selected tools are available',
    detail: unavailableTools.length
      ? `Selected tools not reported by VS Code: ${unavailableTools.join(', ')}.`
      : 'All selected agent and prompt tools are reported by VS Code.',
    fix: unavailableTools.length ? 'openDocs' : undefined
  });
  return { checks, unavailableTools };
}

function activityChecks(sources: ActivitySourceRuntimeState[]): SetupCheck[] {
  return sources.map((source) => {
    const severity: SetupCheckSeverity = source.state === 'watching' ? 'ok' : source.state === 'disabled' ? 'info' : 'warning';
    return {
      id: `activity.${source.id}`,
      category: 'activity',
      severity,
      title: source.label,
      detail: source.detail,
      fix: severity === 'ok' || severity === 'info' ? undefined : source.id === 'copilotDebugLogs' ? 'openSettings' : 'openDocs'
    };
  });
}

function renderCategory(title: string, checks: SetupCheck[]): string[] {
  return [
    `## ${title}`,
    '',
    checks.length ? checks.map(renderCheck).join('\n') : 'No checks.',
    ''
  ];
}

function renderCheck(check: SetupCheck): string {
  const lines = [
    `- **${check.severity.toUpperCase()}** ${check.title}`,
    `  ${check.detail}`
  ];
  if (check.fix) lines.push(`  Fix: ${fixLabel(check.fix)}`);
  return lines.join('\n');
}

function fixLabel(fix: SetupFixAction): string {
  if (fix === 'openSettings') return 'Open Agent Flow or Copilot settings.';
  if (fix === 'createDefaultPipeline') return 'Run Agent Flow: Create Default Pipeline.';
  return 'Open the Agent Flow documentation.';
}

function compareVersions(left: string, right: string): number {
  const a = left.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const b = right.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function groupBy<T, K>(values: T[], key: (value: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const value of values) {
    const bucket = map.get(key(value)) ?? [];
    bucket.push(value);
    map.set(key(value), bucket);
  }
  return map;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}
