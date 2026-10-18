// Finds the sibling skill orca-pod that orca-pod-setup needs. Node built-ins only:
// this file must not import anything from orca-pod, or the check would fail together with the missing sibling.
//
// `npx skills` puts skills side by side: in a global install the real copies live in
// ~/.agents/skills/<name>, and ~/.claude/skills/<name> are links to them. Node resolves relative
// imports `../../orca-pod/...` from the module's real path, so the sibling is looked up from the skill's realpath.

import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

const SIBLING = 'orca-pod';
const MARKER = path.join('scripts', 'config-location.mjs');

// Where the sibling should be (from the skill's real path) — for the error message.
export function expectedPipelineSkill(setupSkillDir) {
  let real;
  try { real = realpathSync(setupSkillDir); }
  catch { real = path.resolve(setupSkillDir); }
  return path.join(path.dirname(real), SIBLING);
}

// The path to orca-pod next to orca-pod-setup, or null if it is not there.
export function findPipelineSkill(setupSkillDir) {
  const candidate = expectedPipelineSkill(setupSkillDir);
  return existsSync(path.join(candidate, MARKER)) ? candidate : null;
}

export function PIPELINE_MISSING(expected) {
  return 'orca-pod skill not found at ' + expected + '; orca-pod-setup needs it next to itself — install the skills: npx skills add Salesao/orca-pod -g -y -s orca-pod orca-pod-setup plan-blitz -a claude-code codex pi';
}
