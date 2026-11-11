export const PRESET_HELPER_NAMES = ['worker', 'scout', 'researcher', 'reviewer', 'verifier', 'oracle', 'evidence-auditor'];

/** A user-authored definition or an installed custom name does not consume a preset slot. */
export function isPresetHelper(name, settings) {
  return PRESET_HELPER_NAMES.includes(name) && !Object.keys(helperDefinition(settings)).length;
}

/** Optional session-local definition; omitted fields retain installed native-agent lookup. */
export function helperDefinition(settings) {
  return Object.fromEntries(['description', 'instructions']
    .filter((field) => Object.hasOwn(settings, field)).map((field) => [field, settings[field]]));
}

export function helperDefinitionError(settings) {
  if (!Object.keys(helperDefinition(settings)).length) return null;
  if (typeof settings.description !== 'string' || !settings.description.trim() || /[\r\n]/.test(settings.description)) return 'description';
  if (typeof settings.instructions !== 'string' || !settings.instructions.trim()) return 'instructions';
  return null;
}
