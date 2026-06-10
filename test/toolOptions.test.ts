import { describe, expect, it } from 'vitest';
import { listToolOptionNames } from '../src/webview/toolOptions';

describe('VS Code tool options', () => {
  it('uses unique sorted tool names from VS Code language model tools', () => {
    expect(listToolOptionNames([
      { name: 'terminal', description: '', inputSchema: undefined, tags: [] },
      { name: 'codebase', description: '', inputSchema: undefined, tags: [] },
      { name: 'terminal', description: 'duplicate', inputSchema: {}, tags: ['run'] },
      { name: '  ', description: 'ignored', inputSchema: undefined, tags: [] }
    ])).toEqual(['codebase', 'terminal']);
  });
});
