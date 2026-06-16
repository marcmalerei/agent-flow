import { describe, expect, it } from 'vitest';
import { shouldFocusLiveActivity } from '../src/webview/activityFocus';

describe('live activity focus', () => {
  it('only follows a new active node when follow mode is enabled and the viewport is not user-controlled', () => {
    expect(shouldFocusLiveActivity({
      activeNodeId: 'worker',
      followLiveActivity: true,
      inspectorOpen: false,
      lastFocusedActivityNode: 'router',
      userViewportInteracted: false
    })).toBe(true);

    expect(shouldFocusLiveActivity({
      activeNodeId: 'worker',
      followLiveActivity: false,
      inspectorOpen: false,
      lastFocusedActivityNode: 'router',
      userViewportInteracted: false
    })).toBe(false);

    expect(shouldFocusLiveActivity({
      activeNodeId: 'worker',
      followLiveActivity: true,
      inspectorOpen: true,
      lastFocusedActivityNode: 'router',
      userViewportInteracted: false
    })).toBe(false);

    expect(shouldFocusLiveActivity({
      activeNodeId: 'worker',
      followLiveActivity: true,
      inspectorOpen: false,
      lastFocusedActivityNode: 'router',
      userViewportInteracted: true
    })).toBe(false);
  });

  it('does not refocus the same activity node repeatedly', () => {
    expect(shouldFocusLiveActivity({
      activeNodeId: 'worker',
      followLiveActivity: true,
      inspectorOpen: false,
      lastFocusedActivityNode: 'worker',
      userViewportInteracted: false
    })).toBe(false);
  });
});
