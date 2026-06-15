import type { CopilotDebugLogStatus } from './copilotDebugLogAdapter';
import type { CodexRolloutStatus } from './codexRolloutAdapter';

export type ActivitySourceState = 'disabled' | 'initializing' | 'watching' | 'degraded' | 'error';
export type ActivitySourceId = 'filesystem' | 'vscodeDocuments' | 'agentFlowTools' | 'copilotDebugLogs' | 'codexRollouts' | 'readCoverage';

export interface ActivitySourceRuntimeState {
  id: ActivitySourceId;
  label: string;
  state: ActivitySourceState;
  detail: string;
  canReportReads: boolean;
  canReportWrites: boolean;
  metadata?: Record<string, unknown>;
}

export interface ActivitySourceStatusInput {
  filesystem: {
    enabled: boolean;
    watchingPatterns?: string[];
  };
  documents: {
    enabled: boolean;
  };
  tools: {
    enabled: boolean;
    registered: boolean;
  };
  copilotDebugLogs: CopilotDebugLogStatus;
  codexRollouts: CodexRolloutStatus;
}

export function buildActivitySourceStatuses(input: ActivitySourceStatusInput): ActivitySourceRuntimeState[] {
  const sources: ActivitySourceRuntimeState[] = [
    filesystemSource(input.filesystem),
    documentsSource(input.documents),
    toolsSource(input.tools),
    copilotDebugLogSource(input.copilotDebugLogs),
    codexRolloutSource(input.codexRollouts)
  ];
  return [...sources, readCoverageSource(sources)];
}

function filesystemSource(input: ActivitySourceStatusInput['filesystem']): ActivitySourceRuntimeState {
  if (!input.enabled) {
    return {
      id: 'filesystem',
      label: 'Filesystem watcher',
      state: 'disabled',
      detail: 'Filesystem write activity is disabled in Agent Flow settings.',
      canReportReads: false,
      canReportWrites: false
    };
  }
  return {
    id: 'filesystem',
    label: 'Filesystem watcher',
    state: input.watchingPatterns?.length ? 'watching' : 'initializing',
    detail: input.watchingPatterns?.length
      ? `Watching ${input.watchingPatterns.length} pipeline file pattern${input.watchingPatterns.length === 1 ? '' : 's'} for writes.`
      : 'Preparing pipeline file watchers.',
    canReportReads: false,
    canReportWrites: true,
    metadata: input.watchingPatterns?.length ? { patterns: input.watchingPatterns } : undefined
  };
}

function documentsSource(input: ActivitySourceStatusInput['documents']): ActivitySourceRuntimeState {
  return input.enabled
    ? {
      id: 'vscodeDocuments',
      label: 'VS Code document events',
      state: 'watching',
      detail: 'Open and save events for .github pipeline files are reported as read/write activity.',
      canReportReads: true,
      canReportWrites: true
    }
    : {
      id: 'vscodeDocuments',
      label: 'VS Code document events',
      state: 'disabled',
      detail: 'VS Code document activity is disabled in Agent Flow settings.',
      canReportReads: false,
      canReportWrites: false
    };
}

function toolsSource(input: ActivitySourceStatusInput['tools']): ActivitySourceRuntimeState {
  if (!input.enabled) {
    return {
      id: 'agentFlowTools',
      label: 'Agent Flow LM tools',
      state: 'disabled',
      detail: 'Agent Flow language model activity tools are disabled in settings.',
      canReportReads: false,
      canReportWrites: false
    };
  }
  return {
    id: 'agentFlowTools',
    label: 'Agent Flow LM tools',
    state: input.registered ? 'watching' : 'degraded',
    detail: input.registered
      ? 'Language model tools can report node progress, tool calls, file reads, file writes, and handoffs.'
      : 'VS Code did not expose language model tool registration in this session.',
    canReportReads: input.registered,
    canReportWrites: input.registered
  };
}

function copilotDebugLogSource(status: CopilotDebugLogStatus): ActivitySourceRuntimeState {
  if (!status.enabled) {
    return {
      id: 'copilotDebugLogs',
      label: 'Copilot debug logs',
      state: 'disabled',
      detail: status.detail,
      canReportReads: false,
      canReportWrites: false,
      metadata: copilotMetadata(status)
    };
  }
  return {
    id: 'copilotDebugLogs',
    label: 'Copilot debug logs',
    state: status.state === 'watching' ? 'watching' : 'degraded',
    detail: status.detail,
    canReportReads: status.state === 'watching',
    canReportWrites: status.state === 'watching',
    metadata: copilotMetadata(status)
  };
}

function codexRolloutSource(status: CodexRolloutStatus): ActivitySourceRuntimeState {
  if (!status.enabled) {
    return {
      id: 'codexRollouts',
      label: 'Codex rollout logs',
      state: 'disabled',
      detail: status.detail,
      canReportReads: false,
      canReportWrites: false,
      metadata: codexMetadata(status)
    };
  }
  return {
    id: 'codexRollouts',
    label: 'Codex rollout logs',
    state: status.state === 'watching' ? 'watching' : 'degraded',
    detail: status.detail,
    canReportReads: status.state === 'watching',
    canReportWrites: status.state === 'watching',
    metadata: codexMetadata(status)
  };
}

function readCoverageSource(sources: ActivitySourceRuntimeState[]): ActivitySourceRuntimeState {
  const readCapable = sources.filter((source) => source.id !== 'filesystem' && source.canReportReads && source.state === 'watching');
  return readCapable.length
    ? {
      id: 'readCoverage',
      label: 'Read coverage',
      state: 'watching',
      detail: `Reads can be reported by ${readCapable.map((source) => source.label).join(', ')}.`,
      canReportReads: true,
      canReportWrites: false
    }
    : {
      id: 'readCoverage',
      label: 'Read coverage',
      state: 'degraded',
      detail: 'Reads require VS Code document events, Agent Flow LM tools, or Copilot debug logs. Filesystem watchers can only infer writes.',
      canReportReads: false,
      canReportWrites: false
    };
}

function copilotMetadata(status: CopilotDebugLogStatus): Record<string, unknown> {
  return {
    copilotFileLoggingEnabled: status.copilotFileLoggingEnabled,
    configuredPath: status.configuredPath,
    discoveredRoots: status.discoveredRoots
  };
}

function codexMetadata(status: CodexRolloutStatus): Record<string, unknown> {
  return {
    codexHome: status.codexHome,
    discoveredFiles: status.discoveredFiles
  };
}
