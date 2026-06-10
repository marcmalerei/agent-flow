import { describe, expect, it } from 'vitest';
import { markdownToTiptapHtml, tiptapJsonToMarkdown } from '../src/webview/markdown';

describe('TipTap markdown bridge', () => {
  it('converts existing Markdown into TipTap HTML', () => {
    expect(markdownToTiptapHtml('# Agent\n\nUse **bold** `code` and [docs](https://example.com).\n- @router\n- Done')).toBe('<h1>Agent</h1><p>Use <strong>bold</strong> <code>code</code> and <a href="https://example.com">docs</a>.</p><ul><li>@router</li><li>Done</li></ul>');
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

  it('preserves frontmatter blocks as preformatted Markdown', () => {
    const markdown = '---\nname: Agent\ndescription: Keeps metadata\n---\n\n# Body';

    expect(markdownToTiptapHtml(markdown)).toBe('<pre><code>---\nname: Agent\ndescription: Keeps metadata\n---</code></pre><h1>Body</h1>');
    expect(tiptapJsonToMarkdown({
      type: 'doc',
      content: [
        { type: 'codeBlock', content: [{ type: 'text', text: '---\nname: Agent\ndescription: Keeps metadata\n---' }] },
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Body' }] }
      ]
    })).toBe(markdown);
  });

  it('preserves fenced code blocks with language hints', () => {
    expect(markdownToTiptapHtml('```ts\nconst value = 1;\n```')).toBe('<pre><code data-language="ts">const value = 1;</code></pre>');
    expect(tiptapJsonToMarkdown({
      type: 'doc',
      content: [
        { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const value = 1;' }] }
      ]
    })).toBe('```ts\nconst value = 1;\n```');
  });

  it('serializes inline code and links back to Markdown', () => {
    expect(tiptapJsonToMarkdown({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Read ' },
            { type: 'text', text: 'docs', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
            { type: 'text', text: ' and run ' },
            { type: 'text', text: 'npm test', marks: [{ type: 'code' }] },
            { type: 'text', text: '.' }
          ]
        }
      ]
    })).toBe('Read [docs](https://example.com) and run `npm test`.');
  });
});
