# Default Pipeline Demo

Use the default pipeline as the canonical first-run product demo. It is intentionally small enough to read in one graph overview and covers the core concepts a new user should learn in under a minute.

## Demo Flow

1. Run `Agent Flow: Create Default Pipeline` in a fresh workspace.
2. Fit the graph and show the full story: start prompt, router, implementer, reviewer, fixer, request/plan/result artifacts, and project/test instructions.
3. Use `Add Node` for node creation near the implementation lane.
4. Select `implementer` and use reference editing to attach an instruction or artifact, then show the resulting edges.
5. Run `Agent Flow: Play Demo Activity` so temporary activity badges explain routing and handoff behavior.

## Expected Outcome

- The graph opens without critical diagnostics.
- The default nodes fit in one readable overview.
- Every visible edge teaches one concept: prompt start, handoff, artifact read/write, or instruction reference.
- Generated files contain concise demo-safe Markdown and no private data.
- Marketplace screenshots and GIFs can use the same steps as automated smoke checks.
