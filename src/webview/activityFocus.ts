export interface ActivityFocusInput {
  activeNodeId?: string;
  followLiveActivity: boolean;
  inspectorOpen: boolean;
  lastFocusedActivityNode?: string;
  userViewportInteracted: boolean;
}

export function shouldFocusLiveActivity(input: ActivityFocusInput): boolean {
  if (!input.followLiveActivity) return false;
  if (!input.activeNodeId) return false;
  if (input.inspectorOpen) return false;
  if (input.userViewportInteracted) return false;
  return input.lastFocusedActivityNode !== input.activeNodeId;
}
