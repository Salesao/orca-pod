import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fchmodSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { configLocation, projectLocation } from '../../orca-pod/scripts/config-location.mjs';
import { listProfiles, parsePipelineYaml } from '../../orca-pod/scripts/pipeline-config.mjs';
import { planProfileReduction } from '../../orca-pod/scripts/profile-upgrade.mjs';

const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function formOnlyError(code, message) {
  return Object.assign(new Error(message), { code });
}

function readActiveFile(location) {
  const targetPath = location.activePath;
  // existsSync in configLocation treats a dangling worktree symlink as absent.
  // Refuse it rather than silently edit the main checkout's shared file.
  if (location.worktreePath && location.worktreePath !== targetPath) {
    let local;
    try {
      local = lstatSync(location.worktreePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (local?.isSymbolicLink()) {
      throw formOnlyError('FORM_ONLY_INVALID_CONFIG', 'The worktree config is a link; run orca-pod-setup after fixing it.');
    }
  }
  let stat;
  try {
    stat = lstatSync(targetPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw formOnlyError('FORM_ONLY_SETUP_REQUIRED', `No Orca Pod config at ${targetPath}; run orca-pod-setup first.`);
    }
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw formOnlyError('FORM_ONLY_INVALID_CONFIG', 'orca-pod.yaml must be a regular file, not a directory or a link.');
  }

  const bytes = readFileSync(targetPath);
  return { targetPath, bytes, stat, sourceHash: createHash('sha256').update(bytes).digest('hex') };
}

/** Read a configured project's active file without migrating or rewriting it. */
export function readFormOnlyConfig(location) {
  const { targetPath, bytes, sourceHash } = readActiveFile(location);
  let text;
  try {
    // Keep a UTF-8 BOM in the returned text so its hash reflects the file exactly.
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw formOnlyError('FORM_ONLY_INVALID_CONFIG', 'orca-pod.yaml must contain valid UTF-8; run orca-pod-setup to repair it.');
  }

  let reduction;
  try {
    const document = parsePipelineYaml(text);
    if (!isMap(document.profiles) || Object.keys(document.profiles).length === 0 ||
        typeof document.active_profile !== 'string' || !Object.hasOwn(document.profiles, document.active_profile) ||
        Object.values(document.profiles).some((profile) => !isMap(profile))) {
      throw new Error('the active profile or profiles mapping is invalid');
    }
    reduction = planProfileReduction(text);
  } catch {
    // Parser errors may include configuration contents, so keep diagnostics generic.
    throw formOnlyError('FORM_ONLY_INVALID_CONFIG', 'Cannot safely open orca-pod.yaml: invalid YAML or profile structure; run orca-pod-setup.');
  }
  if (reduction.changed) {
    throw formOnlyError('FORM_ONLY_UPGRADE_REQUIRED', 'The config needs a profile upgrade; run orca-pod-setup first.');
  }

  return { targetPath, text, sourceHash };
}

function activeSnapshot(cwd, targetPath) {
  const location = configLocation(projectLocation(cwd));
  if (path.resolve(location.activePath) !== path.resolve(targetPath)) {
    throw formOnlyError('FORM_ONLY_CONFLICT', 'The active configuration path changed; reopen the form.');
  }
  try {
    return readActiveFile(location);
  } catch (error) {
    if (error.code === 'FORM_ONLY_SETUP_REQUIRED') {
      throw formOnlyError('FORM_ONLY_CONFLICT', 'The configuration no longer exists; reopen the form.');
    }
    throw error;
  }
}

function validateSubmittedYaml(yaml) {
  try {
    const result = listProfiles(parsePipelineYaml(yaml));
    if (!result.profiles.length || result.profiles.some((profile) => !profile.valid)) throw new Error('invalid profile');
    return result.profiles;
  } catch {
    // Parser errors can contain user-provided text; never echo YAML into diagnostics.
    throw formOnlyError('FORM_ONLY_INVALID_RESULT', 'The submitted YAML or one of its profiles is invalid; reopen the form.');
  }
}

/** Validate and atomically replace the file only if its source snapshot still matches. */
export function applyFormOnly({ cwd, targetPath, sourceHash, yaml }) {
  if (typeof cwd !== 'string' || !cwd || typeof targetPath !== 'string' || !path.isAbsolute(targetPath) ||
      typeof sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(sourceHash)) {
    throw formOnlyError('FORM_ONLY_CONFLICT', 'The original configuration snapshot is missing or invalid; reopen the form.');
  }
  if (typeof yaml !== 'string' || !yaml.trim()) {
    throw formOnlyError('FORM_ONLY_INVALID_RESULT', 'The submitted YAML is empty or invalid; reopen the form.');
  }
  const original = activeSnapshot(cwd, targetPath);
  if (original.sourceHash !== sourceHash) {
    throw formOnlyError('FORM_ONLY_CONFLICT', 'The configuration changed while the form was open; reopen it.');
  }
  const profiles = validateSubmittedYaml(yaml);
  const temporary = path.join(path.dirname(original.targetPath), `.orca-pod-form-${randomUUID()}.tmp`);
  let descriptor;
  let created = false;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    created = true;
    writeFileSync(descriptor, yaml, 'utf8');
    fchmodSync(descriptor, original.stat.mode & 0o777);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    const latest = activeSnapshot(cwd, targetPath);
    if (latest.sourceHash !== sourceHash || latest.stat.dev !== original.stat.dev || latest.stat.ino !== original.stat.ino ||
        (latest.stat.mode & 0o777) !== (original.stat.mode & 0o777)) {
      throw formOnlyError('FORM_ONLY_CONFLICT', 'The configuration changed during saving; reopen the form.');
    }
    renameSync(temporary, original.targetPath);
    created = false;
  } finally {
    try {
      if (descriptor !== undefined) {
        try { closeSync(descriptor); }
        catch (error) { if (error.code !== 'EBADF') throw error; }
      }
    } finally {
      if (created) rmSync(temporary, { force: true });
    }
  }
  return { status: 'saved', targetPath: original.targetPath, profiles };
}
