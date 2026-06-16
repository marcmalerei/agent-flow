# Default Pipeline Demo

Use the default pipeline as the canonical first-run product demo. It is intentionally small enough to read in one graph overview and covers the core concepts a new user should learn in under a minute.

## Demo Flow

1. Run `Agent Flow: Start Guided Demo` in a fresh workspace.
2. Choose `Create Sample Files` only when recording in a disposable workspace; otherwise use the current graph or cancel without writing files.
3. Fit the meaningful flow and show the full story: start prompt, router, implementer, reviewer, fixer, request/plan/result artifacts, and project/test instructions.
4. Use `Add Node` for node creation near the implementation lane.
5. Select `implementer` and use reference editing to attach an instruction or artifact, then show the resulting edges.
6. Let the guided demo activity badges explain routing, handoff, artifact reads/writes, and completion behavior.
7. Run `Agent Flow: Reset Guided Demo` to clear demo activity without changing workspace files.

## Expected Outcome

- The graph opens without critical diagnostics.
- The default nodes fit in one readable overview.
- Every visible edge teaches one concept: prompt start, handoff, artifact read/write, or instruction reference.
- Generated files contain concise demo-safe Markdown and no private data.
- Marketplace screenshots and GIFs can use the same steps as automated smoke checks.
- Resetting the demo clears activity only; real workspace files are written only after the explicit `Create Sample Files` choice.
