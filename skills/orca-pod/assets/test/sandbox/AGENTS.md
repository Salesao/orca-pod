# Sandbox for `orca-pod test`

A training project for the test run of the pipeline. Changes here do not affect
working projects.

- Node.js >= 20, ESM, **no dependencies** — do not add any and do not create `node_modules`.
- Allowed checks: `node --test`, `node --check <file>`.
- Do not change `TASK.md`, `AGENTS.md`, `.orca-pod-sandbox` or the existing `slugify`.
- Do not make Git writes: the baseline commit is created by the prepare script.
