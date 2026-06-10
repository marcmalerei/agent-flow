export interface TiptapNode {
  type?: string;
  text?: string;
  attrs?: { level?: number };
  marks?: Array<{ type?: string }>;
  content?: TiptapNode[];
}

export function markdownToTiptapHtml(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push(`<h${heading[1].length}>${inlineMarkdownToHtml(heading[2])}</h${heading[1].length}>`);
      index += 1;
      continue;
    }

    if (/^-\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^-\s+/.test(lines[index])) {
        items.push(`<li>${inlineMarkdownToHtml(lines[index].replace(/^-\s+/, ''))}</li>`);
        index += 1;
      }
      blocks.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !/^(#{1,3})\s+/.test(lines[index]) && !/^-\s+/.test(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(`<p>${inlineMarkdownToHtml(paragraph.join(' '))}</p>`);
  }

  return blocks.join('');
}

export function tiptapJsonToMarkdown(document: TiptapNode): string {
  return (document.content ?? [])
    .map(nodeToMarkdown)
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function nodeToMarkdown(node: TiptapNode): string {
  if (node.type === 'heading') return `${'#'.repeat(clampHeadingLevel(node.attrs?.level))} ${childrenToMarkdown(node)}`;
  if (node.type === 'paragraph') return childrenToMarkdown(node);
  if (node.type === 'bulletList') return (node.content ?? []).map((item) => `- ${childrenToMarkdown(item)}`).join('\n');
  if (node.type === 'listItem') return childrenToMarkdown(node);
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'text') return textToMarkdown(node);
  return childrenToMarkdown(node);
}

function childrenToMarkdown(node: TiptapNode): string {
  return (node.content ?? []).map(nodeToMarkdown).join('').trim();
}

function textToMarkdown(node: TiptapNode): string {
  const text = node.text ?? '';
  if (node.marks?.some((mark) => mark.type === 'bold')) return `**${text}**`;
  return text;
}

function inlineMarkdownToHtml(value: string): string {
  return escapeHtml(value).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clampHeadingLevel(value: number | undefined): number {
  if (value === 1 || value === 2 || value === 3) return value;
  return 2;
}
