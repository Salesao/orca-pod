// Match the versioned orca-cli skill; never fall back to another runtime on failure.
export function orcaCommand(env = process.env, platform = process.platform) {
  if (env.ORCA_CLI_COMMAND) return env.ORCA_CLI_COMMAND;
  if (env.ORCA_DEV_REPO_ROOT) return 'orca-dev';
  // orca-ide avoids accidentally starting the GNOME screen reader on Linux.
  return platform === 'linux' ? 'orca-ide' : 'orca';
}
