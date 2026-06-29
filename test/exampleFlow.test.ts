import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateFiles } from '../src/pipeline/generators';
import { parsePipelineJson } from '../src/pipeline/parser';
import { inferPipelineFromWorkspace } from '../src/pipeline/scanner';
import { AgentPipeline } from '../src/pipeline/types';
import { validatePipeline } from '../src/pipeline/validator';
import { handlePersistPipelineMessage } from '../src/webview/panelMessages';

const exampleRoot = path.join(process.cwd(), 'examples/basic-flow');
const pipelineFile = path.join(exampleRoot, '.agent-pipeline/pipeline.json');
const webviewExampleFile = path.join(exampleRoot, 'webview.html');

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
  it('provides browser webview activity sources in runtime array shape', async () => {
    const html = await fs.readFile(webviewExampleFile, 'utf8');

    expect(html).toContain('activitySources: [');
    expect(html).not.toContain('activitySources: {');
  });

  it('covers every configured node type and has no broken references', async () => {
    const pipeline = await readExamplePipeline();
    const types = new Set(pipeline.nodes.map((node) => node.type));
    const edgeKinds = new Set(pipeline.edges.map((edge) => edge.kind));

    expect(types).toEqual(new Set(['agent', 'prompt', 'instruction', 'skill', 'artifact', 'gate', 'hook']));
    expect(edgeKinds).toEqual(new Set(['artifact', 'flow', 'gate', 'handoff', 'prompt']));
    expect(validatePipeline(pipeline).filter((finding) => finding.severity === 'error')).toEqual([]);
  });

  it('deduplicates artifact producers in informational findings', async () => {
    const pipeline = await readExamplePipeline();
    const finding = validatePipeline(pipeline).find((item) => item.ruleId === 'artifact-written-never-consumed');

    expect(finding?.message).toContain('written by reviewer but never consumed');
    expect(finding?.message).not.toContain('reviewer, reviewer');
  });

  it('generates Markdown for all editable VS Code Agent Flow file types', async () => {
    const pipeline = await readExamplePipeline();
    const files = generateFiles(pipeline);
    const paths = files.map((file) => file.path);
    const routerAgent = files.find((file) => file.path === '.github/agents/router.agent.md');
    const prompt = files.find((file) => file.path === '.github/prompts/triage-request.prompt.md');

    expect(paths).not.toContain('.github/agent-flow.json');
    expect(paths).toContain('.github/agents/router.agent.md');
    expect(paths).toContain('.github/prompts/triage-request.prompt.md');
    expect(paths).toContain('.github/instructions/docs-scope.instructions.md');
    expect(paths).toContain('.github/skills/review-pr/SKILL.md');
    expect(paths).toContain('.github/artifacts/triage.md');
    expect(routerAgent?.content).toContain('handoffs:\n  - label: "Review Plan"');
    expect(routerAgent?.content).toContain('tools:\n  - "agent"\n  - "agentflow_report_activity"\n  - "read"\n  - "search"');
    expect(routerAgent?.content).toContain('# Agent Flow activity reporting');
    expect(routerAgent?.content).toContain('agents:\n  - "implementer"');
    expect(routerAgent?.content).toContain('<!--agent-flow:begin artifact-ref action="write" path=".github/artifacts/triage.md"-->');
    expect(routerAgent?.content).toContain('Write the selected route, involved agents, and open risks.');
    expect(routerAgent?.content).toContain('<!--agent-flow:begin instruction-ref target=".github/instructions/docs-scope.instructions.md"-->');
    expect(routerAgent?.content).toContain('Apply if the route includes documentation work.');
    expect(prompt?.content).toContain('agent: "router"');
    expect(prompt?.content).toContain('Start with `router`.');
    expect(prompt?.content).toContain('<!--agent-flow:begin artifact-ref action="read" path=".github/artifacts/triage.md"-->');
    expect(prompt?.content).toContain('Use this artifact to decide whether the request is ready for implementation.');
  });

  it('auto-persists generated Markdown files from webview messages without flow JSON', async () => {
    const pipeline = await readExamplePipeline();
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agentflow-example-'));
    const calls: string[] = [];

    const saved = await handlePersistPipelineMessage({
      message: { command: 'persistPipeline', pipeline, selectedId: 'router' },
      workspace,
      writePipeline: async () => {
        calls.push('skip-flow-json');
      },
      writeMarkdownFiles: async (targetWorkspace, nextPipeline) => {
        await writeGeneratedMarkdown(targetWorkspace, nextPipeline);
        calls.push('write-markdown');
      },
      postState: async (_nextPipeline, selectedId) => {
        calls.push(`state:${selectedId}`);
      }
    });

    expect(saved).toBeDefined();
    expect(calls).toEqual(['skip-flow-json', 'write-markdown', 'state:router']);
    await expect(fs.readFile(path.join(workspace, '.github/agent-flow.json'), 'utf8')).rejects.toThrow();
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
    expect(router?.artifactUsages).toEqual([{ path: '.github/artifacts/triage.md', action: 'write', instruction: 'Write the selected route, involved agents, and open risks.' }]);
    expect(router?.instructionRefs).toEqual([{ target: '.github/instructions/docs-scope.instructions.md', instruction: 'Apply if the route includes documentation work.' }]);
    expect(prompt?.startAgent).toBe('router');
    expect(prompt?.artifactUsages).toEqual([{ path: '.github/artifacts/triage.md', action: 'read', instruction: 'Use this artifact to decide whether the request is ready for implementation.' }]);
    expect(prompt?.instructionRefs).toEqual([{ target: '.github/instructions/docs-scope.instructions.md', instruction: 'Apply when the prompt asks for documentation changes.' }]);
    expect(validatePipeline(inferred).filter((finding) => finding.severity === 'error')).toEqual([]);
  });
});
