#!/usr/bin/env bash
# Connects the form extension for Pi (the orca_pod_setup tool):
#   <skill>/pi-extension -> ~/.pi/agent/extensions/orca-pod-setup
# Idempotent. An existing directory or a link that is not ours is not replaced — prints SKIP.
# Does nothing without pi in PATH.
set -euo pipefail

skill_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
source_dir="$skill_dir/pi-extension"
target="$HOME/.pi/agent/extensions/orca-pod-setup"

if [ ! -f "$source_dir/index.js" ]; then
  echo "SKIP  $source_dir/index.js not found"
  exit 0
fi

if ! command -v pi >/dev/null 2>&1; then
  echo "SKIP  pi not found in PATH, the form extension is not linked"
  exit 0
fi

if [ -L "$target" ]; then
  if [ "$(readlink "$target")" = "$source_dir" ]; then
    echo "OK    $target"
  else
    echo "SKIP  $target -> $(readlink "$target") (a link that is not ours)"
  fi
elif [ -e "$target" ] && grep -qs "orca_pod_setup" "$target/index.js"; then
  # A copy of the extension instead of a link: it does not find the form scripts and falls behind the skill.
  echo "STALE $target — a copy of the extension instead of a link; the form in Pi does not work with it."
  echo "      Fix: rm -r '$target' && '$skill_dir/scripts/link-pi-extension.sh', then /reload in Pi"
elif [ -e "$target" ]; then
  echo "SKIP  $target (existing directory is not replaced)"
else
  mkdir -p "$(dirname "$target")"
  ln -s "$source_dir" "$target"
  echo "LINK  $target -> $source_dir"
  echo "      In Pi run /reload so that the orca_pod_setup tool appears"
fi
