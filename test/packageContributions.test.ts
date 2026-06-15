import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  displayName?: string;
  galleryBanner?: { color?: string; theme?: string };
  icon?: string;
  name?: string;
  scripts?: Record<string, string>;
  contributes?: {
    configuration?: { properties?: Record<string, unknown> };
    commands?: Array<{ category?: string; command: string; title: string }>;
    languageModelTools?: Array<{ name: string; modelDescription?: string; inputSchema?: { properties?: Record<string, unknown> } }>;
    menus?: Record<string, Array<{ command?: string; group?: string; submenu?: string; when?: string }>>;
    submenus?: Array<{ id: string; label: string }>;
  };
  activationEvents?: string[];
};
const root = fileURLToPath(new URL('..', import.meta.url));
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

describe('package contributions', () => {
  it('declares marketplace presentation and packaging metadata', () => {
    expect(manifest.name).toBe('copilot-agent-flow-studio');
    expect(manifest.displayName).toBe('Agent Flow Studio');
    expect(manifest.icon).toBe('media/icon.png');
    expect(existsSync(resolve(root, manifest.icon))).toBe(true);
    expect(manifest.galleryBanner).toEqual({ color: '#0F1216', theme: 'dark' });
    expect(manifest.scripts?.['package:vsix']).toBe('vsce package --out copilot-agent-flow-studio.vsix');
    expect(manifest.scripts?.['package:marketplace']).toContain('npm run build');
    expect(manifest.scripts?.['package:marketplace']).toContain('npm run package:vsix');
  });

  it('uses an externally renderable animated Marketplace preview', () => {
    expect(existsSync(resolve(root, 'media/agent-flow-preview.gif'))).toBe(true);
    expect(readme).toContain('https://raw.githubusercontent.com/marcmalerei/agent-flow/main/media/agent-flow-preview.gif');
    expect(readme).not.toContain('](media/agent-flow-screenshot.png)');
  });

  it('shows one Agent Flow submenu for all markdown files under .github regardless of language id', () => {
    const entries = manifest.contributes?.menus?.['explorer/context'] ?? [];
    const submenuEntry = entries.find((entry) => entry.submenu === 'agentflow.context');
    expect(manifest.contributes?.submenus).toContainEqual({ id: 'agentflow.context', label: 'Agent Flow' });
    expect(submenuEntry).toEqual(expect.objectContaining({
      group: 'navigation@80',
      when: expect.stringContaining('resourceScheme == file')
    }));
    expect(submenuEntry?.when).toContain('resourcePath =~ /[\\\\\\/]\\.github[\\\\\\/].*\\.md$/');
    expect(submenuEntry?.when).not.toContain('resourceLangId');
    expect(entries.filter((entry) => entry.command?.startsWith('agentflow.'))).toHaveLength(0);
  });

  it('keeps Agent Flow actions as submenu entries with short titles', () => {
    const submenuEntries = manifest.contributes?.menus?.['agentflow.context'] ?? [];
    expect(submenuEntries.map((entry) => entry.command)).toEqual([
      'agentflow.openPipeline',
      'agentflow.scanWorkspace',
      'agentflow.validatePipeline',
      'agentflow.checkSetup',
      'agentflow.generateFiles'
    ]);
    expect(submenuEntries.every((entry) => !entry.when)).toBe(true);

    const commands = new Map((manifest.contributes?.commands ?? []).map((command) => [command.command, command]));
    for (const entry of submenuEntries) {
      const command = commands.get(entry.command!);
      expect(command?.category).toBe('Agent Flow');
      expect(command?.title.startsWith('Agent Flow:')).toBe(false);
    }
  });

  it('contributes Agent Flow activity language model tools', () => {
    expect(manifest.activationEvents).toEqual(expect.arrayContaining([
      'onLanguageModelTool:agentflow_select_node',
      'onLanguageModelTool:agentflow_report_activity',
      'onLanguageModelTool:agentflow_complete_node'
    ]));
    const tools = manifest.contributes?.languageModelTools ?? [];
    expect(tools.map((tool) => tool.name)).toEqual([
      'agentflow_select_node',
      'agentflow_report_activity',
      'agentflow_complete_node'
    ]);
    expect(tools.find((tool) => tool.name === 'agentflow_report_activity')?.modelDescription).toContain('Do not include raw prompts');
    expect(tools.find((tool) => tool.name === 'agentflow_report_activity')?.inputSchema?.properties).toHaveProperty('phase');
  });

  it('contributes a demo activity command for Copilot-free smoke tests', () => {
    const commands = new Map((manifest.contributes?.commands ?? []).map((command) => [command.command, command]));
    expect(manifest.activationEvents).toEqual(expect.arrayContaining([
      'onCommand:agentflow.playDemoActivity',
      'onCommand:agentflow.exportReport',
      'onCommand:agentflow.exportActivityCsv',
      'onCommand:agentflow.checkSetup',
      'onCommand:agentflow.importActivityLog',
      'onCommand:agentflow.pauseActivityReplay',
      'onCommand:agentflow.restartActivityReplay'
    ]));
    expect(commands.get('agentflow.playDemoActivity')).toEqual(expect.objectContaining({
      category: 'Agent Flow',
      title: 'Play Demo Activity'
    }));
    expect(commands.get('agentflow.exportReport')).toEqual(expect.objectContaining({
      category: 'Agent Flow',
      title: 'Export Report'
    }));
    expect(commands.get('agentflow.exportActivityCsv')).toEqual(expect.objectContaining({
      category: 'Agent Flow',
      title: 'Export Activity CSV'
    }));
    expect(commands.get('agentflow.checkSetup')).toEqual(expect.objectContaining({
      category: 'Agent Flow',
      title: 'Check Setup'
    }));
    expect(commands.get('agentflow.importActivityLog')).toEqual(expect.objectContaining({
      category: 'Agent Flow',
      title: 'Import Activity Log'
    }));
    expect(commands.get('agentflow.pauseActivityReplay')).toEqual(expect.objectContaining({
      category: 'Agent Flow',
      title: 'Pause Activity Replay'
    }));
    expect(commands.get('agentflow.restartActivityReplay')).toEqual(expect.objectContaining({
      category: 'Agent Flow',
      title: 'Restart Activity Replay'
    }));
  });

  it('contributes independent activity source settings', () => {
    const properties = manifest.contributes?.configuration?.properties ?? {};
    expect(Object.keys(properties)).toEqual(expect.arrayContaining([
      'agentflow.activity.sources.filesystem',
      'agentflow.activity.sources.vscodeDocuments',
      'agentflow.activity.sources.agentFlowTools',
      'agentflow.activity.copilotDebugLogs.enabled',
      'agentflow.activity.codexRollouts.enabled'
    ]));
  });
});
