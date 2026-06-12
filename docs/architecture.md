# Agent Flow Architecture

Agent Flow uses a VS Code extension plus webview architecture.

## Extension host

The extension host owns workspace file access and all write operations. Commands are registered in `src/extension.ts`:

- `agentflow.openPipeline`
- `agentflow.scanWorkspace`
- `agentflow.generateFiles`
- `agentflow.validatePipeline`
- `agentflow.createDefaultPipeline`

The extension host infers the pipeline from `.github` Markdown customization files, normalizes references, validates the result, calculates risk, and sends an editable snapshot to the webview. A legacy `.agent-pipeline/pipeline.json` file is only read as a fallback when no `.github` customization files exist.

## Webview

The webview is a React application built with Vite. It uses `@xyflow/react` to draw an automatically arranged graph and shows:

- node palette
- canvas with typed nodes and edges
- editable node inspector for labels, descriptions, tools, subagents, artifacts, and WYSIWYG Markdown overrides with `@` references and `/` snippets
- collapsible validation panel
- generated files
- tool matrix
- context risk score

The webview edits node configuration, Markdown content, graph references, and artifact usage. It uses VS Code theme color variables and avoids echo-reloading after its own autosaves so typing remains stable. File writes are routed through the extension host, which validates the update and writes the corresponding Markdown/YAML files.

## Pure pipeline modules

The `src/pipeline` modules contain deterministic, testable logic:

- `types.ts` defines the data model.
- `parser.ts` validates the legacy pipeline JSON model used by fixtures and migration fallback.
- `defaultPipeline.ts` creates the default preset.
- `scanner.ts` infers a graph from existing `.github` customization files.
- `referenceResolver.ts` strips YAML quotes and resolves display-name agent references to canonical node ids.
- `validator.ts` implements validation rules.
- `riskScore.ts` calculates the context risk score.
- `generators/*` deterministically generate Markdown and file manifests.

## Safety model

Agent Flow never deletes unknown user files automatically. Live webview edits write only the affected generated/customization files. The `Generate Files` command builds a preview first and writes after explicit confirmation.
