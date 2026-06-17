# Activity Telemetry

Agent Flow Studio can show live activity on graph nodes without reading private Copilot chat history.

## Supported Ingestion

The production-supported ingestion path is the VS Code Language Model Tool API. Agent Flow contributes three tools:

- `agentflow/selectNode` resolves a node by id, label, or backing file path.
- `agentflow/reportActivity` records sanitized progress for a node.
- `agentflow/completeNode` marks a node as completed or failed.

These tools only record short structured activity events. They do not execute user code, read files, or require raw prompt content.

## Event Model

Activity events are workspace-local and kept in memory. Each event can include:

- session id
- node id or file
- phase such as `started`, `tool`, `artifact`, `handoff`, `completed`, or `failed`
- short sanitized summary
- optional tool name, artifact path, duration, token estimate, model, or AI credit estimate
- optional input and output token counts when a source exposes them

Open Agent Flow panels receive activity updates through webview messages. Activity updates do not reload the pipeline and do not rewrite Markdown files.

## Visuals

The graph uses activity events to show:

- stable node badges for the latest node action
- collapsed counts when multiple events affect the same node
- a compact Now card in the activity HUD for the newest fresh node action
- animated active edges for handoffs, artifacts, and instruction references
- an Activity diagnostics tab with a chronological timeline and clear action

Animations respect the operating system's reduced-motion preference.

## Experimental Copilot Debug Log Import

Agent Flow also includes a best-effort adapter for local Copilot debug logs. It only imports events when GitHub Copilot file logging is enabled in VS Code:

```json
{
  "github.copilot.chat.agentDebugLog.fileLogging.enabled": true
}
```

When that Copilot setting is enabled, Agent Flow auto-discovers `GitHub.copilot-chat/debug-logs` folders in the active VS Code profile. A custom folder can be provided when the logs live elsewhere:

```json
{
  "agentflow.activity.copilotDebugLogs.enabled": true,
  "agentflow.activity.copilotDebugLogs.dataPath": "/path/to/copilot/debug/logs"
}
```

The adapter scans bounded `.json` and `.jsonl` files, imports `llm_request` usage rows with positive AI credit values, and maps known session, request, agent, and tool-call style rows when present. It reports malformed rows to the Agent Flow Activity output channel and ignores oversized files.

The adapter is experimental because Copilot debug log structure is not a stable public Agent Flow contract. It never displays raw prompt or transcript contents by default.

## Optional Claude Code Hook Import

Claude Code can run user-defined hooks. Agent Flow can optionally watch a folder where those hooks append JSON or JSONL rows. This is disabled by default because Agent Flow does not install or manage Claude Code hooks for you.

```json
{
  "agentflow.activity.claudeCodeHooks.enabled": true,
  "agentflow.activity.claudeCodeHooks.dataPath": "/path/to/claude-code-hook-logs"
}
```

Each row should contain sanitized hook metadata. Agent Flow recognizes common Claude Code-style fields such as `hook_event_name`, `session_id`, `tool_name`, and `tool_input.file_path`:

```json
{"hook_event_name":"PreToolUse","session_id":"claude-1","tool_name":"Read","tool_input":{"file_path":".github/agents/router.agent.md"}}
{"hook_event_name":"PostToolUse","session_id":"claude-1","tool_name":"Write","tool_input":{"file_path":".github/artifacts/plan.md"}}
```

The adapter maps reads and writes to matching graph nodes when the path is under `.github`. Do not write raw prompts, secrets, file contents, or transcript text into the hook log folder.

## Unsupported

Agent Flow does not rely on undocumented Copilot chat storage or private chat history for production behavior. If Copilot changes internal debug log formats, only the optional debug-log adapter is affected.

VS Code does not expose a stable public API for one extension to subscribe to arbitrary chat activity from another chat extension. Activity from non-Copilot chat extensions, including Codex, is therefore only visible when that agent explicitly calls the Agent Flow activity tools.
