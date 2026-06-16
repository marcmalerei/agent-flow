export type GraphMode = 'edit' | 'run' | 'diagnose';

export type GraphModePanelTarget = 'activity' | 'validation';

export interface GraphModeOption {
  id: GraphMode;
  label: string;
  icon: string;
  description: string;
}

export const graphModes: readonly GraphModeOption[] = [
  { id: 'edit', label: 'Edit', icon: 'edit', description: 'Create nodes, configure references, and edit the selected flow.' },
  { id: 'run', label: 'Run', icon: 'pulse', description: 'Follow live activity, recent events, and active execution paths.' },
  { id: 'diagnose', label: 'Diagnose', icon: 'warning', description: 'Show diagnostics, risky nodes, and repair guidance.' }
];

export function graphModePanelTarget(mode: GraphMode): GraphModePanelTarget | undefined {
  if (mode === 'run') return 'activity';
  if (mode === 'diagnose') return 'validation';
  return undefined;
}
