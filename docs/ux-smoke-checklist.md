# UX Smoke Checklist

Use this checklist before publishing or recording Marketplace assets. Run it in a disposable workspace so generated files and activity events can be inspected freely.

## Setup

1. Build the extension:

   ```bash
   npm run compile
   npm run build:webview
   ```

2. Open a clean Extension Development Host:

   ```bash
   code --extensionDevelopmentPath="$(pwd)" /tmp/agentflow-ux-smoke
   ```

3. Run `Agent Flow: Create Default Pipeline`, then `Agent Flow: Open Pipeline`.

Expected visual outcome:

- The graph appears within 4 seconds.
- Nodes are visible without searching around the canvas.
- The first viewport shows the starter flow as a readable sequence, not a dense stress graph.
- The debug overlay, if enabled, reports matching parsed, webview, and DOM node counts.

Blocking release issues:

- Blank graph or missing nodes after startup.
- Nodes disappear after tab switches, file saves, or filesystem refresh.
- Runtime error shown in the webview.

Cosmetic issues:

- Minor edge label overlap.
- Slightly suboptimal initial zoom.
- Non-critical spacing inconsistency.

## Graph Editing

1. Add one agent, one instruction, one artifact, and one handoff from the UI.
2. Rename the new agent.
3. Confirm the file name and references update after autosave.
4. Select the artifact as both an input and an output on a node.
5. Add instruction text for the artifact reference.

Expected visual outcome:

- New nodes appear immediately.
- Edges appear as soon as the reference is created.
- Autosave is quiet and does not reload or blank the webview.
- Reference editors use the same Markdown editor behavior as node Markdown.

Blocking release issues:

- Added nodes do not write files.
- References are not represented in Markdown.
- Renames leave stale agent names in handoffs or references.
- Autosave causes a webview reset while typing.

Cosmetic issues:

- Reference cards need tighter spacing.
- Tooltips or labels are understandable but not polished.

## Live Activity

1. Run `Agent Flow: Play Demo Activity`.
2. Watch read, write, handoff, and tool events.
3. Keep the webview open for at least 15 seconds.
4. Modify an artifact file externally and confirm the graph remains visible.

Expected visual outcome:

- The active node is prominent within one second of the event.
- Read/write/handoff edges animate only while fresh.
- Activity chips decay instead of staying permanently active.
- Recent activity remains inspectable without overwhelming the graph.

Blocking release issues:

- No visible activity after demo activity starts.
- Activity appears only after a long delay.
- Edges stay permanently animated.
- File changes hide nodes or clear the graph.

Cosmetic issues:

- Activity color could be more expressive.
- Timeline copy could be clearer.

## Diagnostics

1. Open diagnostics.
2. Check Validation, Files, Tools, Activity, and Risk tabs.
3. Trigger a known warning by removing an output artifact from one agent.

Expected visual outcome:

- Each warning names the affected file or node.
- Actions focus the node, open the inspector section, or open the file.
- Risk summaries explain which node or file caused the score.

Blocking release issues:

- Diagnostics only show generic counts.
- A warning cannot be traced to a node or file.
- Fix actions do nothing or focus the wrong node.

Cosmetic issues:

- Wording is technically correct but too long.
- List density needs tuning.

## Marketplace Capture

Use `examples/ux-smoke-workspace` when recording a GIF or screenshot. Follow the [default pipeline demo](default-pipeline-demo.md) for first-run story beats, then capture these frames:

- Default graph after first open.
- Add Node menu with a new artifact or instruction.
- Inspector showing artifact/reference editing.
- Live activity on one agent and one artifact edge.
- Diagnostics with at least one actionable warning.
