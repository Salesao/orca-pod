#!/usr/bin/env bash
# Adds the service folder .orca-pod/ (config and review reports) to the project's .gitignore.
# A .orca-pipeline/ line from older versions stays in .gitignore as it is.
#   ensure-gitignore.sh [git-root]    (default: the root of the repository of the current folder)
# Idempotent. Changes only an existing <git-root>/.gitignore: if there is none, creates nothing
# (SKIP). If the folder is already ignored by any rule, the file does not change (OK).
set -euo pipefail

pattern=".orca-pod/"
root="${1:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"

if [ -z "$root" ] || ! git -C "$root" rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "SKIP  not a Git repository, .gitignore not changed"
  exit 0
fi

root="$(git -C "$root" rev-parse --show-toplevel)"
file="$root/.gitignore"

if [ ! -f "$file" ]; then
  echo "SKIP  $file not found, $pattern not added"
  exit 0
fi

if git -C "$root" check-ignore -q --no-index ".orca-pod/reports/x"; then
  echo "OK    $pattern is already ignored ($file)"
  exit 0
fi

# If the file does not end with a newline, start on a new line.
if [ -s "$file" ] && [ -n "$(tail -c1 "$file")" ]; then printf '\n' >> "$file"; fi
printf '# orca-pod: config and review reports\n%s\n' "$pattern" >> "$file"
echo "ADDED $pattern -> $file"
