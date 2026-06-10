# AgentFlow

AgentFlow is a VS Code extension for visually managing GitHub Copilot agent pipelines. It provides a local, file-based workflow for creating, validating, previewing, and generating Copilot customization files from a single source of truth: `.agent-pipeline/pipeline.json`.

AgentFlow does **not** integrate with Copilot internals, execute agent pipelines, send telemetry, or depend on a backend service. It manages local workspace files only.

## Features

- `AgentFlow: Open Pipeline` opens a React + React Flow visualizer.
- `AgentFlow: Create Default Pipeline` writes a safe default `.agent-pipeline/pipeline.json` preset.
- `AgentFlow: Scan Workspace` loads `pipeline.json` or infers a graph from `.github/agents`, `.github/prompts`, `.github/instructions`, `.github/skills`, and `.agent-output`.
- `AgentFlow: Validate Pipeline` reports pipeline findings and context risk score.
- `AgentFlow: Export Mermaid` copies and previews a Mermaid graph.
- `AgentFlow: Generate Files` previews generated files and asks for confirmation before writing.

## Architecture

```txt
.agent-pipeline/pipeline.json = visual editor source of truth
.github/**                    = generated Copilot customization files
.agent-output/**              = explicit artifact handoff files
AGENT_PIPELINE.md             = generated human-readable diagram
```

The implementation is split into testable pure modules under `src/pipeline` and VS Code/webview integration under `src/extension.ts` and `src/webview`.

## Development

```bash
npm install
npm run compile
npm run build:webview
npm test
```

In restricted environments, package installation may be blocked. The TypeScript sources include lightweight local declaration shims so core type-checking can still be run with a globally available `tsc`.

## Usage

1. Open a workspace in VS Code.
2. Run `AgentFlow: Create Default Pipeline`.
3. Run `AgentFlow: Open Pipeline` to view the pipeline graph.
4. Review validation findings, the tool permission matrix, Mermaid output, and generated file list.
5. Run `AgentFlow: Generate Files` and confirm only after reviewing the preview.

## Keeping context costs low

AgentFlow encourages explicit artifacts and context budgets. Each generated agent file describes required input artifacts, output artifacts, scope rules, verification rules, and context limits so agents do not rely on broad chat history or vague handoffs.
