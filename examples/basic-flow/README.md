# Agent Flow Example Pipeline

This workspace fixture exercises every Agent Flow node type and the important write paths:

- pipeline JSON save under `.agent-pipeline/pipeline.json`
- generated agent, prompt, instruction, skill, and artifact Markdown files
- flow, prompt, handoff, gate, and artifact edges
- config-driven references for tools, subagents, handoffs, inputs, and outputs

Run the webview outside VS Code during development:

```sh
npm run dev:webview:example
```

Then open:

```text
http://127.0.0.1:5174/examples/basic-flow/webview.html
```
