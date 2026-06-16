export interface WorkspaceFileSummary {
  hasGithubFolder: boolean;
  supportedFileCount: number;
}

export type FlowEmptyStateKind = 'none' | 'no-workspace-files' | 'no-supported-files' | 'no-graphable-nodes';

export interface FlowEmptyState {
  kind: FlowEmptyStateKind;
  title: string;
  detail: string;
  primaryAction: EmptyStateAction;
  secondaryActions: EmptyStateAction[];
}

export interface EmptyStateAction {
  label: string;
  command: 'agentflow.createDefaultPipeline' | 'agentflow.scanWorkspace' | 'agentflow.checkSetup' | 'agentflow.playDemoActivity' | 'agentflow.openDocs';
  icon: string;
}

export function deriveFlowEmptyState(nodeCount: number, workspace?: WorkspaceFileSummary): FlowEmptyState {
  if (nodeCount > 0) return noneState();
  if (!workspace?.hasGithubFolder) {
    return {
      kind: 'no-workspace-files',
      title: 'Start with a sample flow',
      detail: 'This workspace does not have a .github customization folder yet. Create the sample pipeline, open existing customization files, or learn with demo activity.',
      primaryAction: action('Create sample pipeline', 'agentflow.createDefaultPipeline', 'sparkle'),
      secondaryActions: [
        action('Open existing .github pipeline', 'agentflow.scanWorkspace', 'folder-opened'),
        action('Check Setup', 'agentflow.checkSetup', 'checklist'),
        action('Learn with demo activity', 'agentflow.playDemoActivity', 'pulse'),
        action('Open Docs', 'agentflow.openDocs', 'book')
      ]
    };
  }
  if ((workspace.supportedFileCount ?? 0) === 0) {
    return {
      kind: 'no-supported-files',
      title: 'Create a sample graph',
      detail: 'Agent Flow found .github, but no agent, prompt, instruction, skill, role, or artifact files that can become graph nodes.',
      primaryAction: action('Create sample pipeline', 'agentflow.createDefaultPipeline', 'sparkle'),
      secondaryActions: [
        action('Open existing .github pipeline', 'agentflow.scanWorkspace', 'folder-opened'),
        action('Check Setup', 'agentflow.checkSetup', 'checklist'),
        action('Learn with demo activity', 'agentflow.playDemoActivity', 'pulse'),
        action('Open Docs', 'agentflow.openDocs', 'book')
      ]
    };
  }
  return {
    kind: 'no-graphable-nodes',
    title: 'Files found, but no graph nodes yet',
    detail: 'Agent Flow found supported files, but could not infer graph nodes from them. Validate the workspace to see what is missing.',
    primaryAction: action('Check Setup', 'agentflow.checkSetup', 'checklist'),
    secondaryActions: [
      action('Scan Workspace', 'agentflow.scanWorkspace', 'refresh'),
      action('Create Default Pipeline', 'agentflow.createDefaultPipeline', 'sparkle'),
      action('Play Demo Activity', 'agentflow.playDemoActivity', 'pulse'),
      action('Open Docs', 'agentflow.openDocs', 'book')
    ]
  };
}

function noneState(): FlowEmptyState {
  return {
    kind: 'none',
    title: '',
    detail: '',
    primaryAction: action('Scan Workspace', 'agentflow.scanWorkspace', 'refresh'),
    secondaryActions: []
  };
}

function action(label: EmptyStateAction['label'], command: EmptyStateAction['command'], icon: string): EmptyStateAction {
  return { label, command, icon };
}
