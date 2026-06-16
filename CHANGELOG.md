# Changelog

## Unreleased

- Fix the browser webview example so the local UX preview renders activity sources with the runtime-compatible data shape.
- Make the configuration inspector and diagnostics panel resizable, and wrap long debug-log diagnostics so details stay readable.
- Add selected-node inspector sync context with file path, node type, runtime state, and task-oriented health/content labels.
- Add an opt-in Follow live activity toggle that centers the newest active node without changing zoom and respects manual viewport/inspector use.
- Anchor graph edges at visible node ports and hide low-priority support labels until hover, focus, or live activity.
- Reserve explicit node header/body/status regions for token counts, identity, diagnostics, stale state, and activity chips so graph labels remain readable.
- Add graph startup and recovery states for render delays, invisible nodes, render failures, retry actions, and debug snapshot copying.
- Simplify the default pipeline for first-run comprehension with lowercase names, canonical tool ids, explicit handoffs, fewer nodes, and readable compact layout.
- Improve graph accessibility with keyboard node navigation, shortcut help, ARIA labels, reduced-motion handling, and high-contrast styles.
- Simplify the generated default pipeline to a smaller first-run flow with lowercase nodes, valid handoffs, artifact references, and instruction references.
- Add a release UX smoke checklist and fixture workspace for graph editing, activity, diagnostics, and Marketplace capture checks.
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
- Add guided connection creation with explicit intents and Markdown write previews for handoffs, artifacts, instructions, roles, prompts, gates, and connected node creation.

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
