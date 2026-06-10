# AgentFlow

AgentFlow is a VS Code extension for visually managing GitHub Copilot agent pipelines. It provides a local, file-based workflow for creating, validating, previewing, and generating Copilot customization files from a single source of truth: `.agent-pipeline/pipeline.json`.

AgentFlow does **not** integrate with Copilot internals, execute agent pipelines, send telemetry, or depend on a backend service. It manages local workspace files only.

## Features

- `AgentFlow: Open Pipeline` opens a React + React Flow visualizer with editable node configuration.
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

Pull requests and pushes to `main` run CI with `npm ci`, `npm run check`, `npm run build:webview`, and `npm audit`.

In restricted environments, package installation may be blocked. The TypeScript sources include lightweight local declaration shims so core type-checking can still be run with a globally available `tsc`.

## Running in VS Code while developing

Use an **Extension Development Host** when you want to test AgentFlow from this source checkout without packaging or installing a `.vsix`.

### 1. Install and build

From the repository root:

```bash
npm install
npm run compile
npm run build:webview
```

`npm run compile` creates the extension host entrypoint at `dist/extension.js`. `npm run build:webview` creates the webview assets expected by the extension under `webview-dist/assets/`.

### 2. Launch from VS Code

Open this repository in VS Code:

```bash
code .
```

Then press `F5` and choose an **Extension Host** launch configuration if VS Code offers one. If there is no launch configuration yet, create `.vscode/launch.json` locally with:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run AgentFlow Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}"
      ],
      "outFiles": [
        "${workspaceFolder}/dist/**/*.js"
      ],
      "preLaunchTask": "npm: compile"
    }
  ]
}
```

This opens a second VS Code window named **Extension Development Host**. That window is where AgentFlow is installed for the current debugging session.

### 3. Launch from the command line

You can also start VS Code with this checkout loaded as a development extension:

```bash
code --extensionDevelopmentPath="$(pwd)"
```

To test AgentFlow against a separate disposable workspace, pass the workspace path after the extension path:

```bash
mkdir -p /tmp/agentflow-smoke
code --extensionDevelopmentPath="$(pwd)" /tmp/agentflow-smoke
```

### 4. Exercise AgentFlow commands

In the **Extension Development Host** window, open the Command Palette and run:

1. `AgentFlow: Create Default Pipeline`
2. `AgentFlow: Open Pipeline`
3. `AgentFlow: Validate Pipeline`
4. `AgentFlow: Export Mermaid`
5. `AgentFlow: Generate Files`

Use a disposable workspace for `AgentFlow: Generate Files` while testing. The command shows a generated-file preview and asks for confirmation before writing files, but the generated files are still intended to modify the active workspace after confirmation.

### 5. Optional packaged install for manual testing

For a local install that behaves more like a normal VS Code extension, package a `.vsix` and install it manually:

```bash
npm run build
npx @vscode/vsce package
code --install-extension agentflow-0.0.1.vsix
```

After installing a packaged build, reload VS Code and run the AgentFlow commands from the Command Palette. Rebuild and reinstall the `.vsix` whenever you want to test new source changes outside the Extension Development Host.

## Usage

1. Open a workspace in VS Code.
2. Run `AgentFlow: Create Default Pipeline`.
3. Run `AgentFlow: Open Pipeline` to view the pipeline graph.
4. Click a node to edit its label, description, tools, subagents, artifacts, and Markdown override in the inspector.
5. Drag nodes on the canvas to update their saved positions.
6. Use `Save & reload flow` to persist graph/configuration edits and refresh validation, generated files, Mermaid, and the tool matrix.
7. Use the WYSIWYG Markdown editor toolbar for headings/lists/bold text, type `@` to reference agents, skills, prompts, artifacts, or files, and type `/` for snippets such as dates and checklists.
8. Expand the diagnostics drawer only when you need validation, generated files, Mermaid, tool matrix, or context risk details.
9. Run `AgentFlow: Generate Files` and confirm only after reviewing the preview.

## Keeping context costs low

AgentFlow encourages explicit artifacts and context budgets. Each generated agent file describes required input artifacts, output artifacts, scope rules, verification rules, and context limits so agents do not rely on broad chat history or vague handoffs.

## Editing nodes

The webview supports direct node configuration in the inspector and uses VS Code theme colors so it blends into light and dark installations. Select a node to edit common fields, choose agent tools with checkboxes, choose callable subagents from known agents, update artifact lists, and maintain a Markdown override in the WYSIWYG editor. The editor stores Markdown, provides a rendered preview, preserves frontmatter, fenced code blocks, headings, bullet lists, bold text, inline code, and HTTP(S) links, and supports `@` references for agents, skills, prompts, artifacts, and files plus `/` snippets for dates and checklists. Dragging nodes updates their position in the draft pipeline; saving writes the updated `.agent-pipeline/pipeline.json` and reloads the flow state so validation and generated previews reflect the changes. Generated node files are still written only after explicit confirmation. The diagnostics drawer is collapsed by default so validation and generated-file details do not crowd the canvas.
