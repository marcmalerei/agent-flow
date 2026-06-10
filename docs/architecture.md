# AgentFlow Architecture

AgentFlow uses a VS Code Extension + Webview architecture.

## Extension host

The extension host owns workspace file access and all write operations. Commands are registered in `src/extension.ts`:

- `agentflow.openPipeline`
- `agentflow.scanWorkspace`
- `agentflow.generateFiles`
- `agentflow.validatePipeline`
- `agentflow.exportMermaid`
- `agentflow.createDefaultPipeline`

The extension host loads or infers the pipeline, validates it, calculates risk, and sends a read-only snapshot to the webview.

## Webview

The webview is a React application built with Vite. It uses `@xyflow/react` to draw the graph and shows:

- node palette
- canvas with typed nodes and edges
- node inspector
- validation panel
- generated files
- Mermaid source
- tool matrix
- context risk score

The MVP webview is intentionally read-only. File writes are routed back through VS Code commands so the extension host can show previews and confirmation prompts.

## Pure pipeline modules

The `src/pipeline` modules contain deterministic, testable logic:

- `types.ts` defines the data model.
- `parser.ts` validates and serializes `pipeline.json`.
- `defaultPipeline.ts` creates the default preset.
- `scanner.ts` loads `pipeline.json` or infers a graph from existing files.
- `validator.ts` implements validation rules.
- `riskScore.ts` calculates the context risk score.
- `generators/*` deterministically generate Markdown, Mermaid, and file manifests.

## Safety model

AgentFlow never deletes user files automatically. Generation builds a preview first and writes files only after explicit confirmation. Unknown workspace files are preserved.
