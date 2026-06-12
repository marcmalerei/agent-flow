# Agent Flow Studio

Visualize and edit GitHub Copilot customization files as a live graph inside VS Code.

![Agent Flow Studio interactive pipeline demo](https://raw.githubusercontent.com/marcmalerei/agent-flow/refs/heads/codex/reference-markdown-editors/media/agent-flow-preview.gif)

Agent Flow Studio is a local, file-based editor for `.github` agent, prompt, instruction, skill, role, and artifact files. It helps teams understand how Copilot customization files reference each other, edit those files safely, and spot context or routing problems before they become hard to reason about.

The extension does not execute pipelines, call Copilot agents, read private Copilot internals, send telemetry, or depend on a backend service. It manages local workspace files only.

## Features

- Open a live graph inferred from `.github` Markdown and YAML files.
- Edit node metadata, tools, handoffs, artifacts, references, and Markdown from a VS Code themed inspector.
- Auto-save webview edits directly back to the relevant Markdown files.
- Keep graph edges synchronized with Markdown references, handoffs, and artifact usage.
- Choose language model tools from VS Code's registered tool list.
- Show token estimates per node and diagnostics for validation, files, tools, and context risk.
- Create starter agents, prompts, instructions, skills, roles, artifacts, gates, hooks, and MCP server nodes.
- Use context menu entries on supported `.github` files to open, scan, validate, or generate Agent Flow files.

## Quick Start

Agent Flow Studio requires VS Code `1.120.0` or newer.

1. Open a workspace in VS Code.
2. Run `Agent Flow: Create Default Pipeline` from the Command Palette.
3. Run `Agent Flow: Open Pipeline`.
4. Click a node to edit its configuration.
5. Connect nodes or update references in the inspector to change the underlying Markdown.

Changes made in the graph are written to the matching file immediately. The graph layout is inferred automatically from the current workspace files.

## Supported Files

```txt
.github/agents/**/*.agent.md                 custom agent files
.github/prompts/**/*.prompt.md               reusable prompt files
.github/instructions/**/*.instructions.md    custom instruction files
.github/skills/**/SKILL.md                   Copilot skill files
.github/roles/**/*.role.md                   reusable role files
.github/artifacts/**/*.md                    explicit artifact handoff files
```

Agent Flow Studio preserves frontmatter where possible and omits optional YAML fields when they are empty.

## Common Workflows

- Use agent nodes to manage model, target environment, invocation settings, tools, handoffs, and subagents.
- Use prompt and instruction nodes to keep reusable guidance visible in the graph.
- Use artifact nodes to make inputs and outputs explicit between agents, prompts, instructions, and skills.
- Use role nodes for reusable role descriptions that can be referenced from Markdown.
- Use diagnostics when you need validation details, a file inventory, tool coverage, or a context risk summary.

## Documentation

- [Customization frontmatter](docs/customization-frontmatter.md)
- [Generated files](docs/generated-files.md)
- [Validation rules](docs/validation-rules.md)
- [Architecture](docs/architecture.md)
- [Development](docs/development.md)
- [Publishing](docs/publishing.md)

## Limitations

- Agent Flow Studio manages local files only. It does not run agents or execute workflows.
- The tool picker reflects tools registered in the current VS Code session. Saved tools that are not currently registered are still shown so they can be reviewed or removed.
- Markdown round-tripping is optimized for Agent Flow reference blocks, frontmatter, headings, lists, emphasis, inline code, fenced code blocks, and links. Arbitrary Markdown extensions may not preserve every editor detail.
