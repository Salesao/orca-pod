# Role terminals

Run the commands below from the project root on the **target execution host**. Use the installed skill's absolute script paths. The examples use relative paths for readability. For a paired host, run the helper there, where its own Orca is `local`. Keep the Coordinator's paired route with the address for delivery from another host. Chat roles use the chat launcher and its mailbox receipt.

## Preflight and bootstrap

1. Print the exact managed workspace address, even in a main checkout where the shared and worktree config paths coincide.

   ```sh
   node scripts/role-terminal.mjs workspace
   ```

   An ambiguous path needs `workspace --worktree '<exact Orca selector>'`. Copy the environment and selector from `orca worktree show` or `worktree ps`. Run on the remote execution host when its address is remote. `config-location.mjs where` locates the YAML independently.
2. Run `node scripts/launch-provider.mjs --roles --resolve --profile <profile> --coordinator`. Each role lists `effectiveAccess`, the requested helper policy and `helperPreflight`. Local CLI configuration or an installed adapter can be checked before launch. For Pi the additional live probe runs at session start. Chat and providers without a live readiness API report unverified. If configured helpers cannot be verified, warn before dispatch, then follow the inline/degradation contract.
3. Choose one fresh run ID (e.g. the output of `node -p "require('crypto').randomUUID()"`) and pass it to every role and handoff in this pipeline. Create each terminal in a single operation.

   ```sh
   node scripts/role-terminal.mjs create --run <run> --role reviewer --profile <profile> --worktree '<exact selector>'
   ```

   The issued terminal runs its own shell-quoted bootstrap. It checks the workspace, actual handle and incarnation, then starts the configured provider. The run pins the workspace and a fingerprint of the selected profile when the first terminal is created. The file registry under `.orca-pod/runs/<run>/<role>/` binds a role to this generation. A repaint or rename has no bearing on routing. The launcher never sends a shell command into an existing terminal. On a lost create receipt, use `resolve` for this run and role. A confirmed pre-allocation argument or selector rejection permits a corrected retry and retains the rejected generation. A pending claim with no verified binding means that the launch outcome is unknown. Inspect the workspace and original create receipt without repeating the launch.
4. Resolve the assigned recipient before dispatch, including when restoring a missing reply address.

   ```sh
   node scripts/role-terminal.mjs resolve --run <run> --role reviewer
   ```

   The result contains the host/workspace, address, PTY ID and `processIncarnation` (Orca's PTY incarnation). `terminal_bound` confirms the new pane, `provider_spawned` additionally confirms that the OS started the configured executable, and `exited` records the wrapper's exit. `requested` contains the configured model and thinking. `observed` holds only a runtime observation of the parent role, `null` when unavailable. `helpers` is live Pi session evidence when reported. A ready helper policy still needs to admit each launch. Every terminal requires the usual `tui-idle` check and Codex Planner needs its Plan-mode preparation. A task turn starts only when the dispatch receipt or receiving role supplies that evidence. Pass the verified environment and address to the handoff helper.

## Reading and retaining diagnostics

| Provider | Live read |
| --- | --- |
| Qoder | Rendered screen first |
| Pi, Codex, Claude Code, OMP | Accumulated tail, with rendered-screen fallback for blank or control/box-only output |

```sh
node scripts/role-terminal.mjs read --run <run> --role implementer --limit 60
node scripts/role-terminal.mjs read --run <run> --role implementer --saved
node scripts/role-terminal.mjs read --run <run> --role implementer --saved --generation 1
```

`--lines` aliases `--limit` in the helper. The Orca CLI accepts `--limit`. A live read prints the output and its source. `screen-unavailable` means Orca could only return accumulated output. The helper uses Orca’s terminal output and ignores the separate UI draft field.

The bootstrap samples up to 60 lines every 30 seconds and once at exit when possible. An explicit read also updates the private generation record. `diagnostic.excerpt` keeps up to 8 KiB of the last readable output, with its own source, terminal status and observation time. A later empty frame updates the sample status and preserves that excerpt. Up to 32 protocol markers and diagnostic categories provide a short index. A sudden exit can leave only an earlier sample.

The excerpt strips terminal controls and redacts recognizable credential fields, common tokens, private-key blocks and URLs. Its source can include anything the program printed or rendered, including echoed input. Redaction is best effort. New run directories and records use private permissions. The helper adds a local `.orca-pod/runs/.gitignore` containing `*` when absent and respects an existing file.

Use `--saved` after the terminal or host is unavailable. Attribute a retrospective quotation to its captured output and sampling time. Cite the role’s report or other saved evidence for a verdict or cause of death.

## Same-role replacement

The Coordinator can recover a dead terminal for the **same logical role** mid-pipeline. Freeze deliveries to its old address, reconcile outstanding messages and wait for live helpers, workers and writes to settle. For a vanished role inspect host/process and project evidence, including independent agents. Resume once you can confirm that work has stopped. Confirm that the old incarnation has exited or its handle is stale on the recorded runtime. A timeout or `writable: false` alone is insufficient.

```sh
node scripts/role-terminal.mjs create --run <run> --role reviewer --profile <profile> --replace <old-handle> --children-settled
```

`--children-settled` records the operator's reconciliation of children. The helper separately checks the old terminal on the original runtime. A role fingerprint checks the selected provider, model, effort, helper definitions and routes, concurrency, review mode, language and access policy across launch and recovery. The new generation keeps its own process and diagnostics and the prior generation stays available via `read --saved --generation N`. Re-run readiness and any required mode check. Transfer stage, version, cycle, fix attempt, evidence snapshot and report paths into its recovery contract. Broadcast `ROLE_HANDLE_REPLACED` to every active role using each verified address. Reconcile accepted/unacknowledged messages against durable reports, receiver acknowledgements and work already done. Reissue only the confirmed outstanding assignment with a reference to the original message, on the same attempt. See [handoff contracts](handoff-contracts.md) for the complete payload.
