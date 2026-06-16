import type { FindingSeverity } from '../pipeline/types';
import type { NodeRuntimeState } from './nodeRuntimeState';

export type InspectorSyncKind = 'saved' | 'running' | 'external-change' | 'needs-attention';

export interface InspectorSyncStatus {
  kind: InspectorSyncKind;
  label: string;
  detail: string;
  icon: string;
}

export function deriveInspectorSyncStatus(input: { runtime?: NodeRuntimeState; findingSeverities?: readonly FindingSeverity[] }): InspectorSyncStatus {
  const severities = input.findingSeverities ?? [];
  if (severities.includes('error')) {
    return {
      kind: 'needs-attention',
      label: 'Needs attention',
      detail: 'Validation errors affect this node.',
      icon: 'warning'
    };
  }
  if (input.runtime?.status === 'error' || input.runtime?.activity === 'failed') {
    return {
      kind: 'needs-attention',
      label: 'Runtime issue',
      detail: input.runtime.activitySummary ?? 'The last activity for this node failed.',
      icon: 'error'
    };
  }
  if (input.runtime?.activity && input.runtime.activity !== 'idle') {
    return {
      kind: 'running',
      label: activityLabel(input.runtime.activity),
      detail: input.runtime.activitySummary ?? 'Recent activity is linked to this node.',
      icon: 'pulse'
    };
  }
  if (input.runtime?.dirty || input.runtime?.status === 'stale') {
    return {
      kind: 'external-change',
      label: 'Sync pending',
      detail: 'File changes are being reconciled with the inspector.',
      icon: 'sync'
    };
  }
  if (severities.includes('warning') || severities.includes('risk')) {
    return {
      kind: 'needs-attention',
      label: 'Review recommended',
      detail: 'Warnings or risk findings are attached to this node.',
      icon: 'warning'
    };
  }
  return {
    kind: 'saved',
    label: 'Saved',
    detail: 'Inspector changes are written back to the backing Markdown file.',
    icon: 'pass'
  };
}

function activityLabel(activity: NodeRuntimeState['activity']): string {
  if (activity === 'reading') return 'Reading';
  if (activity === 'writing') return 'Writing';
  if (activity === 'running') return 'Running';
  if (activity === 'failed') return 'Runtime issue';
  return 'Saved';
}
