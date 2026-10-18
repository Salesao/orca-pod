#!/usr/bin/env bash
# Links the pipeline's helper agents into the providers' user directories:
#   agents/claude/*.md -> ~/.claude/agents/   (Claude Code)
#   agents/pi/*.md     -> ~/.pi/agent/agents/ (Pi, pi-subagents)
# Idempotent. An existing regular file or a live link that is not ours (another installed skill version
# may still use it) is not replaced — prints SKIP.
# A dangling link that is not ours (it pointed into an older version that was removed) is replaced with ours — prints RELINK.
# Our own broken links (an agent removed from the skill, for example courier) are deleted — prints UNLINK.
set -euo pipefail

skill_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)" # real path: the skill is also connected through ~/.claude/skills

link_dir() {
  local source_dir="$1" target_dir="$2"
  [ -d "$source_dir" ] || return 0
  mkdir -p "$target_dir"
  for source in "$source_dir"/*.md; do
    [ -e "$source" ] || continue
    local target="$target_dir/$(basename "$source")"
    if [ -L "$target" ]; then
      local current
      current="$(readlink "$target")"
      if [ "$current" = "$source" ]; then
        echo "OK    $target"
      elif [ ! -e "$target" ]; then
        # dangling: it pointed into an older skill version that was removed — nothing uses it, relink to ours
        rm "$target"
        ln -s "$source" "$target"
        echo "RELINK $target -> $source (was dangling: $current)"
      else
        echo "SKIP  $target -> $current (a link that is not ours)"
      fi
    elif [ -e "$target" ]; then
      echo "SKIP  $target (existing file is not replaced)"
    else
      ln -s "$source" "$target"
      echo "LINK  $target -> $source"
    fi
  done
  for target in "$target_dir"/*.md; do
    [ -L "$target" ] && [ ! -e "$target" ] || continue
    case "$(readlink "$target")" in
      "$source_dir"/*) rm "$target"; echo "UNLINK $target (agent removed from the skill)" ;;
    esac
  done
}

link_dir "$skill_dir/agents/claude" "$HOME/.claude/agents"
link_dir "$skill_dir/agents/pi" "$HOME/.pi/agent/agents"
