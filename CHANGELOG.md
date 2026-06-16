# Changelog

## Unreleased

- Require every pull request to update `CHANGELOG.md` before CI can pass.
- Add a pull request template that asks for verification commands, release notes, and documentation status.
- Document release hygiene for keeping Marketplace documentation and changelog entries current.
- Fix the README preview GIF URL so Marketplace renders the asset from `main`.
- Add an optional Claude Code hook activity adapter that imports sanitized JSON/JSONL tool events from a configured local folder.
- Add grouped builder palette sections, graph copy/paste, redo support, editable gate branches, error-path edges, and loop edge highlighting.
- Add recoverable first-run and empty-canvas states with actions for creating a default pipeline, scanning, setup checks, and docs.
- Improve graph readability with semantic compact layout lanes, quieter support edges, and selected-node focus highlighting.
- Add a live activity HUD, recent activity trail, and reduced-motion handling for temporary graph activity visuals.
- Split fresh activity animation from softer recent node status so stale activity no longer animates edges.
- Reorganize the inspector into task-oriented sections with quick actions, sticky file context, and selected-tool summaries.
- Add actionable validation diagnostics with ready-to-run status, entity metadata, filters, and node/file actions.

## 0.0.1

- Add a VS Code webview for visual Agent Flow pipeline editing.
- Support live reference edges for agents, prompts, and artifacts.
- Use VS Code language model tools as the inspector tool source.
- Add a TipTap-backed Markdown editor with Markdown storage.
- Generate Copilot agent, prompt, instruction, skill, and artifact files.
- Add validation, risk scoring, and generated-file preview commands.
- Add Marketplace packaging metadata, icon, gallery banner, and support documentation.
- Add local Activity telemetry with Agent Flow language model tools, node badges, active edge pulses, diagnostics timeline, and GitHub Copilot debug-log import when Copilot file logging is enabled.
- Add a reproducible Marketplace preview GIF that demonstrates adding nodes, editing configuration, and creating reference edges.
