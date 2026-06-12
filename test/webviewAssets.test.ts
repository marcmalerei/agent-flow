import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

describe('webview assets', () => {
  test('loads Codicons from packaged webview resources', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { devDependencies?: Record<string, string> };
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');
    const componentSource = readFileSync('src/webview/components.tsx', 'utf8');
    const panelSource = readFileSync('src/webview/panel.ts', 'utf8');

    expect(packageJson.devDependencies).toHaveProperty('@vscode/codicons');
    expect(webviewSource).toContain("@vscode/codicons/dist/codicon.css");
    expect(componentSource).toContain('codicon codicon-');
    expect(panelSource).toContain('font-src ${webview.cspSource};');
  });

  test('uses a compact Add Node menu instead of a node button strip', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');

    expect(webviewSource).toContain('add-node-menu');
    expect(webviewSource).toContain('Add Node');
    expect(webviewSource).not.toContain('className="node-buttons"');
  });

  test('uses compact TipTap editors for reference instructions', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');

    expect(webviewSource).toContain('ReferenceMarkdownEditor');
    expect(webviewSource).toContain('variant="compact"');
    expect(webviewSource).not.toContain('placeholder="Add the instruction for this artifact." onChange');
    expect(webviewSource).not.toContain('placeholder={`How should this node apply');
  });
});
