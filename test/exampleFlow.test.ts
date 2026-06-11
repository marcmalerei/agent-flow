import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateFiles } from '../src/pipeline/generators';
import { parsePipelineJson, stringifyPipeline } from '../src/pipeline/parser';
import { inferPipelineFromWorkspace } from '../src/pipeline/scanner';
import { AgentPipeline } from '../src/pipeline/types';
import { validatePipeline } from '../src/pipeline/validator';
import { handleSavePipelineMessage, handleWriteMarkdownFilesMessage } from '../src/webview/panelMessages';

const exampleRoot = path.join(process.cwd(), 'examples/basic-flow');
const pipelineFile = path.join(exampleRoot, '.agent-pipeline/pipeline.json');

async function readExamplePipeline(): Promise<AgentPipeline> {
  return parsePipelineJson(await fs.readFile(pipelineFile, 'utf8'));
}

async function writeGeneratedMarkdown(workspace: string, pipeline: AgentPipeline): Promise<void> {
  for (const file of generateFiles(pipeline).filter((item) => item.kind !== 'pipeline')) {
    const target = path.join(workspace, file.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content, 'utf8');
  }
}

describe('basic example flow', () => {
  it('covers every configured node type and has no broken references', async () => {
    const pipeline = await readExamplePipeline();
    const types = new Set(pipeline.nodes.map((node) => node.type));
    const edgeKinds = new Set(pipeline.edges.map((edge) => edge.kind));

    expect(types).toEqual(new Set(['agent', 'prompt', 'instruction', 'skill', 'artifact', 'gate', 'hook']));
    expect(edgeKinds).toEqual(new Set(['artifact', 'flow', 'gate', 'handoff', 'prompt']));
    expect(validatePipeline(pipeline).filter((finding) => finding.severity === 'error')).toEqual([]);
  });

  it('generates Markdown for all editable VS Code AgentFlow file types', async () => {
    const pipeline = await readExamplePipeline();
    const files = generateFiles(pipeline);
    const paths = files.map((file) => file.path);
    const routerAgent = files.find((file) => file.path === '.github/agents/router.agent.md');
    const prompt = files.find((file) => file.path === '.github/prompts/triage-request.prompt.md');

    expect(paths).toContain('.agent-pipeline/pipeline.json');
    expect(paths).toContain('.github/agents/router.agent.md');
    expect(paths).toContain('.github/prompts/triage-request.prompt.md');
    expect(paths).toContain('.github/instructions/docs-scope.instructions.md');
    expect(paths).toContain('.github/skills/review-pr/SKILL.md');
    expect(paths).toContain('.agent-output/triage.md');
    expect(routerAgent?.content).toContain('handoffs:\n  - label: "Review Plan"');
    expect(routerAgent?.content).toContain('tools:\n  - "agent"\n  - "read"\n  - "search"');
    expect(routerAgent?.content).toContain('agents:\n  - "implementer"');
    expect(routerAgent?.content).toContain('- Write `.agent-output/triage.md`: Write the selected route, involved agents, and open risks.');
    expect(routerAgent?.content).toContain('- Follow `.github/instructions/docs-scope.instructions.md`: Apply if the route includes documentation work.');
    expect(prompt?.content).toContain('agent: "router"');
    expect(prompt?.content).toContain('Start with `router`.');
    expect(prompt?.content).toContain('- Read `.agent-output/triage.md`: Use this artifact to decide whether the request is ready for implementation.');
  });

  it('saves pipeline JSON and writes generated Markdown files from webview messages', async () => {
    const pipeline = await readExamplePipeline();
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agentflow-example-'));
    const calls: string[] = [];

    const saved = await handleSavePipelineMessage({
      message: { command: 'savePipeline', pipeline, selectedId: 'router' },
      workspace,
      writePipeline: async (targetWorkspace, nextPipeline) => {
        await fs.mkdir(path.join(targetWorkspace, '.agent-pipeline'), { recursive: true });
        await fs.writeFile(path.join(targetWorkspace, '.agent-pipeline/pipeline.json'), stringifyPipeline(nextPipeline), 'utf8');
        calls.push('save');
      },
      postState: async (_nextPipeline, selectedId) => {
        calls.push(`state:${selectedId}`);
      },
      showSavedMessage: async () => {
        calls.push('saved-message');
      }
    });

    const written = await handleWriteMarkdownFilesMessage({
      message: { command: 'writeMarkdownFiles', pipeline: saved, selectedId: 'router' },
      workspace,
      confirmWrite: async (count) => {
        calls.push(`confirm:${count}`);
        return true;
      },
      writeMarkdownFiles: async (targetWorkspace, nextPipeline) => {
        await writeGeneratedMarkdown(targetWorkspace, nextPipeline);
        calls.push('write-markdown');
      },
      postState: async (_nextPipeline, selectedId) => {
        calls.push(`write-state:${selectedId}`);
      },
      showWrittenMessage: async (count) => {
        calls.push(`written-message:${count}`);
      }
    });

    expect(written).toBeDefined();
    expect(calls).toEqual(['save', 'state:router', 'saved-message', 'confirm:9', 'write-markdown', 'write-state:router', 'written-message:9']);
    expect(parsePipelineJson(await fs.readFile(path.join(workspace, '.agent-pipeline/pipeline.json'), 'utf8')).nodes).toHaveLength(pipeline.nodes.length);
    expect(await fs.readFile(path.join(workspace, '.github/agents/router.agent.md'), 'utf8')).toContain('handoffs:\n  - label: "Review Plan"');
    expect(await fs.readFile(path.join(workspace, '.github/prompts/triage-request.prompt.md'), 'utf8')).toContain('agent: "router"');
  });

  it('can infer a pipeline back from generated Markdown files', async () => {
    const pipeline = await readExamplePipeline();
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agentflow-infer-'));
    await writeGeneratedMarkdown(workspace, pipeline);

    const inferred = await inferPipelineFromWorkspace(workspace);
    const router = inferred.nodes.find((node) => node.id === 'router' && node.type === 'agent');
    const prompt = inferred.nodes.find((node) => node.id === 'triage-request' && node.type === 'prompt');

    expect(router?.type).toBe('agent');
    expect(prompt?.type).toBe('prompt');
    expect(router?.calls).toEqual(['implementer']);
    expect(router?.handoffs).toEqual([{ label: 'Review Plan', agent: 'reviewer', prompt: 'Review the triage and implementation plan before code changes.', send: false }]);
    expect(prompt?.startAgent).toBe('router');
    expect(validatePipeline(inferred).filter((finding) => finding.severity === 'error')).toEqual([]);
  });
});
