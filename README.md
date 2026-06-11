# Agent Flow

Agent Flow is a VS Code extension for visually managing GitHub Copilot agent pipelines. It provides a local, file-based workflow for creating, validating, previewing, and editing Copilot customization files from Markdown/YAML in `.github`.

Agent Flow does **not** integrate with Copilot internals, execute agent pipelines, send telemetry, or depend on a backend service. It manages local workspace files only.

## Features

- `Agent Flow: Open Pipeline` opens a React + React Flow visualizer with editable node configuration.
- `Agent Flow: Create Default Pipeline` writes safe default `.github` customization files.
- `Agent Flow: Scan Workspace` infers a graph from `.github/agents`, `.github/prompts`, `.github/instructions`, `.github/skills`, and `.agent-output`.
- `Agent Flow: Validate Pipeline` reports pipeline findings and context risk score.
- `Agent Flow: Generate Files` previews generated files and asks for confirmation before writing.

## Architecture

```txt
.github/{agents,prompts,instructions,skills}/** = Copilot customization source of truth
.github/agent-flow.json                         = optional Agent Flow view state
.agent-output/**              = explicit artifact handoff files
```

The implementation is split into testable pure modules under `src/pipeline` and VS Code/webview integration under `src/extension.ts` and `src/webview`.

Supported Copilot customization frontmatter is documented in [docs/customization-frontmatter.md](docs/customization-frontmatter.md).

## Development

```bash
npm install
npm run compile
npm run build:webview
npm test
npm run test:smoke
```

Pull requests and pushes to `main` run CI with `npm ci`, `npm run check`, an Extension Host smoke test, `npm run build:webview`, and `npm audit`.

In restricted environments, package installation may be blocked. The TypeScript sources include lightweight local declaration shims so core type-checking can still be run with a globally available `tsc`.

## Running in VS Code while developing

Use an **Extension Development Host** when you want to test Agent Flow from this source checkout without packaging or installing a `.vsix`.

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
      "name": "Run Agent Flow Extension",
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

This opens a second VS Code window named **Extension Development Host**. That window is where Agent Flow is installed for the current debugging session.

### 3. Launch from the command line

You can also start VS Code with this checkout loaded as a development extension:

```bash
code --extensionDevelopmentPath="$(pwd)"
```

To test Agent Flow against a separate disposable workspace, pass the workspace path after the extension path:

```bash
mkdir -p /tmp/agentflow-smoke
code --extensionDevelopmentPath="$(pwd)" /tmp/agentflow-smoke
```

### 4. Exercise Agent Flow commands

In the **Extension Development Host** window, open the Command Palette and run:

1. `Agent Flow: Create Default Pipeline`
2. `Agent Flow: Open Pipeline`
3. `Agent Flow: Validate Pipeline`
4. `Agent Flow: Generate Files`

Use a disposable workspace for `Agent Flow: Generate Files` while testing. The command shows a generated-file preview and asks for confirmation before writing files, but the generated files are still intended to modify the active workspace after confirmation.

### 5. Optional packaged install for manual testing

For a local install that behaves more like a normal VS Code extension, package a `.vsix` and install it manually:

```bash
npm run build
npx @vscode/vsce package
code --install-extension agentflow-0.0.1.vsix
```

After installing a packaged build, reload VS Code and run the Agent Flow commands from the Command Palette. Rebuild and reinstall the `.vsix` whenever you want to test new source changes outside the Extension Development Host.

## Usage

Agent Flow requires VS Code `1.120.0` or newer because the inspector reads available language model tools from the VS Code `lm.tools` API.

1. Open a workspace in VS Code.
2. Run `Agent Flow: Create Default Pipeline`.
3. Run `Agent Flow: Open Pipeline` to view the pipeline graph.
4. Click a node to edit its label, description, tools, subagents, artifacts, and Markdown override in the inspector.
5. Drag nodes on the canvas to update their saved positions.
6. Changes made in the webview are auto-saved to the relevant Markdown/YAML files and `.github/agent-flow.json` view state.
7. Use the WYSIWYG Markdown editor toolbar for headings/lists/bold text, type `@` to reference agents, skills, prompts, artifacts, or files, and type `/` for snippets such as dates and checklists.
8. Expand the diagnostics drawer only when you need validation, generated files, tool matrix, or context risk details.
9. Run `Agent Flow: Generate Files` only when you want to preview generated output outside the live editor.

Set `agentflow.flow.layout` in VS Code settings to change the graph display. `manual` uses saved node positions, while `vertical`, `horizontal`, and `typeColumns` calculate preview-only layouts without overwriting saved positions.

## Keeping context costs low

Agent Flow encourages explicit artifacts and context budgets. Each generated agent file describes required input artifacts, output artifacts, scope rules, verification rules, and context limits so agents do not rely on broad chat history or vague handoffs.

## Editing nodes

The webview supports direct node configuration in the inspector and uses VS Code theme colors so it blends into light and dark installations. Select a node to edit common fields, choose agent tools with checkboxes, choose callable subagents from known agents, update artifact lists, and maintain a Markdown override in the WYSIWYG editor. The editor stores Markdown, preserves frontmatter, fenced code blocks, headings, bullet lists, bold text, inline code, and HTTP(S) links, and supports `@` references for agents, skills, prompts, artifacts, and files plus `/` snippets for dates and checklists. Dragging nodes updates their position in `.github/agent-flow.json`; configuration changes update the corresponding Markdown/YAML files automatically. The diagnostics drawer is collapsed by default so validation and generated-file details do not crowd the canvas.

## Known limitations

- Agent Flow manages local files only. It does not execute pipelines or call Copilot agents.
- The inspector tool list reflects tools currently registered in VS Code. Tools saved in a pipeline but not currently registered are shown as unavailable so they can be removed.
- Markdown editing preserves common Agent Flow constructs, but arbitrary Markdown extensions are not guaranteed to round-trip.
