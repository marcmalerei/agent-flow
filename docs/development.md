# Development

This guide is for working on Agent Flow Studio from a local source checkout.

## Install and Build

```bash
npm install
npm run compile
npm run build:webview
npm test
npm run test:smoke
```

`npm run compile` creates the extension host entrypoint at `dist/extension.js`. `npm run build:webview` creates the webview assets expected by the extension under `webview-dist/assets/`.

`npm run check` runs the full local verification suite used before packaging.

## Run in an Extension Development Host

Open this repository in VS Code:

```bash
code .
```

Press `F5` and choose an Extension Host launch configuration if VS Code offers one. If there is no launch configuration yet, create `.vscode/launch.json` locally:

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

This opens a second VS Code window named Extension Development Host. Agent Flow Studio is installed only for that debugging session.

## Run From the Command Line

You can also start VS Code with this checkout loaded as a development extension:

```bash
code --extensionDevelopmentPath="$(pwd)"
```

To test against a disposable workspace:

```bash
mkdir -p /tmp/agentflow-smoke
code --extensionDevelopmentPath="$(pwd)" /tmp/agentflow-smoke
```

## Exercise Extension Commands

In the Extension Development Host window, open the Command Palette and run:

1. `Agent Flow: Create Default Pipeline`
2. `Agent Flow: Open Pipeline`
3. `Agent Flow: Validate Pipeline`
4. `Agent Flow: Generate Files`

Use a disposable workspace for `Agent Flow: Generate Files` while testing. The command shows a generated-file preview and asks for confirmation before writing files.

For release UX checks, use the [UX smoke checklist](ux-smoke-checklist.md). It covers default-pipeline visibility, graph editing, autosave, activity, diagnostics, and Marketplace capture frames. Use the [default pipeline demo](default-pipeline-demo.md) as the shared first-run script for smoke tests and Marketplace media, and use the [graph visual grammar](graph-visual-grammar.md) when changing node, edge, badge, label, activity, or recovery styling.

## Keyboard shortcuts

The graph canvas is keyboard accessible when it has focus:

- `Arrow keys`: select the nearest node in the pressed direction.
- `Enter`: open the selected node in the inspector.
- `F`: fit the graph to the current viewport.
- `Backspace/Delete`: remove the selected node with undo support.
- `Cmd/Ctrl+C`: copy the selected node.
- `Cmd/Ctrl+V`: paste a duplicate of the copied node.
- `Cmd/Ctrl+Z` and `Cmd/Ctrl+Y`: undo and redo graph edits.
- `?`: show or hide the keyboard shortcut reference.

## Webview Example

The webview can be tested in a browser with fixture data:

```bash
npm run dev:webview:example
```

The Vite server prints the local URL. Open the example page to inspect layout, graph rendering, editor behavior, and VS Code theme variables outside the Extension Development Host.

## Local Packaged Install

For a local install that behaves more like a normal VS Code extension, package a `.vsix` and install it manually:

```bash
npm run build
npm run package:vsix
code --install-extension copilot-agent-flow-studio.vsix
```

After installing a packaged build, reload VS Code and run the Agent Flow commands from the Command Palette. Rebuild and reinstall the `.vsix` whenever you want to test new source changes outside the Extension Development Host.

## CI

Pull requests and pushes to `main` run CI with `npm ci`, `npm run check`, an Extension Host smoke test, `npm run build:webview`, and `npm audit`.

Pull requests must update `CHANGELOG.md` under `Unreleased`. When the change affects commands, settings, screenshots, activity behavior, generated files, validation rules, or Marketplace-facing behavior, update the relevant file in `README.md` or `docs/` in the same PR.

In restricted environments, package installation may be blocked. The TypeScript sources include lightweight local declaration shims so core type-checking can still be run with a globally available `tsc`.
