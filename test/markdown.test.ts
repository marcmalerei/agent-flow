import { describe, expect, it } from 'vitest';
import { markdownToTiptapHtml, tiptapJsonToMarkdown } from '../src/webview/markdown';

describe('TipTap markdown bridge', () => {
  it('converts existing Markdown into TipTap HTML', () => {
    expect(markdownToTiptapHtml('# Agent\n\nUse **bold** text.\n- @router\n- Done')).toBe('<h1>Agent</h1><p>Use <strong>bold</strong> text.</p><ul><li>@router</li><li>Done</li></ul>');
  });

  it('serializes TipTap document JSON back to Markdown', () => {
    expect(tiptapJsonToMarkdown({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Scope' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Keep ' }, { type: 'text', text: 'markdown', marks: [{ type: 'bold' }] }, { type: 'text', text: ' stable.' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '@worker' }] }] }] }
      ]
    })).toBe('## Scope\n\nKeep **markdown** stable.\n\n- @worker');
  });
});
