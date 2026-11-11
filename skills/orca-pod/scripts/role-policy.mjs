import { ROLE_AGENTS } from './pipeline-config.mjs';
import { helperDefinition } from './helper-definition.mjs';

/** Resolve the effective helper selection and initial cumulative diagnostics owner. */
export function resolveRolePolicy(resolvedProfile, role) {
  const { resolvedRoles, reviewMode, maxSubagents, language } = resolvedProfile;
  const settings = resolvedRoles[role];
  if (!settings) throw new Error(`Role ${role} is not configured`);
  const requested = settings.subagentSettings && Object.fromEntries(Object.entries(settings.subagentSettings).map(([name, helper]) => [name, {
    ...helperDefinition(helper),
    model: helper.model === 'inherit' ? settings.model : helper.model,
    thinking: helper.thinking === 'inherit' ? settings.thinking : helper.thinking,
  }]));
  const configured = settings.resolvedSubagentSettings ?? requested ?? Object.fromEntries(
    ROLE_AGENTS[role].map((name) => [name, { model: settings.model, thinking: settings.thinking }]),
  );
  const helpers = settings.shouldUseSubagents ? Object.entries(configured)
    .filter(([name]) => !(role === 'implementer' && reviewMode !== 'self' && name === 'verifier'))
    .map(([name, helper]) => ({ name, model: helper.model, thinking: helper.thinking, ...helperDefinition(helper) })) : [];
  return {
    role, provider: settings.provider, reviewMode, useSubagents: helpers.length > 0, helpers, maxSubagents, language,
    diagnosticOwner: resolvedRoles.reviewer ? 'reviewer' : resolvedRoles.chief_reviewer ? 'chief_reviewer' : 'implementer',
  };
}
