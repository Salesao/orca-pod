---
name: orca-pod-form
description: Use when an already configured project needs its Orca Pod agents, models, roles, helpers or profiles changed without repeating full setup.
---

# Orca Pod form

Open the existing configuration form and save its result without running the full setup. This skill assumes `orca-pod-setup` has already completed for the project. It does not install or link dependencies, initialize memory, run graphify, change project instructions or `.gitignore`, or launch pipeline roles.

## Locate the existing setup

Set `ORCA_FORM_SKILL` to the directory containing this `SKILL.md` in the same shell call that runs the command below. Shell calls may not share variables: retain the printed absolute path, and set `SETUP_DIR` and `ORCA_FORM_REQUEST` again in each shell call that uses them, or substitute their quoted absolute paths.

```sh
node "$ORCA_FORM_SKILL/scripts/locate-setup.mjs"
```

Use the printed real path as `SETUP_DIR`. If a compatible setup and pipeline are not found, stop and tell the user to update or install the Orca Pod skills; do not install them automatically. If the project has no config or needs migration/profile reduction, stop and ask the user to run full `orca-pod-setup`. Do not run it automatically or create a default configuration.

## Open the form

| Host | Form entry point |
| --- | --- |
| Pi | Call `orca_pod_setup({ form_only: true })`. If this option or tool is unavailable, ask for `/reload`; if still unavailable, ask the user to update the setup extension and reload. Do not start the browser server from Bash in Pi. |
| Claude Code | Run `node "$SETUP_DIR/scripts/setup-form.mjs" --form-only` in the background; wait for its completion notification. |
| Codex | Run `node "$SETUP_DIR/scripts/setup-form.mjs" --form-only` with the permissions needed for the local port from the first call; wait for the same command to finish. |
| Qoder | Run `node "$SETUP_DIR/scripts/setup-form.mjs" --form-only` using the host's long-running command support. |
| OMP | Run `node "$SETUP_DIR/scripts/setup-form.mjs" --form-only` using the host's long-running command support. |

The form uses the existing project/worktree config and discovers available model catalogs. Show the `FORM URL` or Pi tool URL if the browser does not open. Use `--no-open` when automatic opening is unavailable. Do not bypass a sandbox restriction or repeatedly start or poll the form. Missing catalogs and permission failures must be reported.

Continue **only** when the returned `status` is `submitted`. On cancellation, timeout, interruption or error, stop without saving or generating defaults. Retain `targetPath`, `sourceHash`, `yaml` and the working directory used for the form. Reopening after invalid YAML uses Pi `current_yaml` or the script's `--current-yaml-file`; the original file's hash remains the source hash.

## Save safely

Warn that regenerating YAML does not retain existing comments. Create a private temporary file outside both the worktree and the config's project folder (mode `0600`). Verify the directory is outside those folders; do not assume `TMPDIR` is safe. For example, on Unix, if `/tmp` is outside the project:

```sh
umask 077
mktemp "/tmp/orca-pod-form.XXXXXX"
```

If that directory is not safe or unavailable, choose another existing directory outside the project or ask the user for one.

Write a single JSON object into the printed file using the host's file-writing tool, not shell interpolation:

```json
{"cwd":"the form's working directory","targetPath":"the returned targetPath","sourceHash":"the returned sourceHash","yaml":"the complete returned YAML"}
```

For example, after setting `ORCA_FORM_REQUEST` to the private file:

```sh
trap 'rm -f "$ORCA_FORM_REQUEST"' EXIT
node "$SETUP_DIR/scripts/apply-form-only.mjs" < "$ORCA_FORM_REQUEST"
```

Always delete the temporary request after the command, including on error. The command validates every profile, rechecks the active path and source hash, and only then replaces the config. If it reports `FORM_ONLY_CONFLICT`, do not overwrite the newer file: explain the conflict and ask to reopen the form. For `FORM_ONLY_INVALID_RESULT`, show the error and offer to reopen with the previous YAML. Report other errors without retrying full setup automatically.

On success, summarize the saved path and each profile's `summary`, marking the default profile. No roles or pipeline have been started.
