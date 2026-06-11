import { describe, expect, it } from 'vitest';
import { FileWatchSuppression } from '../src/webview/fileWatchSuppression';

describe('file watch suppression', () => {
  it('suppresses only recent self-written file events', () => {
    let now = 1_000;
    const suppression = new FileWatchSuppression(() => now, 1_000);

    suppression.markSelfWrites(['/workspace/.github/agents/router.agent.md', '/workspace/.github/prompts/new.prompt.md']);

    expect(suppression.consumeIfSelfWrite('/workspace/.github/prompts/new.prompt.md')).toBe(true);
    expect(suppression.consumeIfSelfWrite('/workspace/.github/prompts/new.prompt.md')).toBe(false);
    expect(suppression.consumeIfSelfWrite('/workspace/.github/agents/manual.agent.md')).toBe(false);

    suppression.markSelfWrites(['/workspace/.github/agents/router.agent.md']);
    now = 2_001;

    expect(suppression.consumeIfSelfWrite('/workspace/.github/agents/router.agent.md')).toBe(false);
  });
});
