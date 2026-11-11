export default function (omp) {
  const { helpers = [], maxSubagents = 6 } = JSON.parse(process.env.ORCA_POD_OMP_POLICY ?? '{}');
  const selected = new Map(helpers.map((helper) => [helper.name, helper]));
  omp.on('session_start', async (_event, ctx) => {
    if (!selected.size || ctx.agent?.kind === 'sub') {
      await omp.setActiveTools(omp.getActiveTools().filter((name) => name !== 'task'));
    }
  });
  omp.on('before_subagent_spawn', (event, ctx) => {
    const name = typeof event.agent === 'string' ? event.agent : event.agent?.name;
    const helper = selected.get(name);
    if (!helper || ctx.agent?.kind === 'sub') return { block: true, reason: 'OMP helper is outside the selected specialization set. Work inline.' };
    return { model: helper.thinking === 'default' ? helper.model : `${helper.model}:${helper.thinking}` };
  });
  omp.on('tool_call', (event) => {
    if (event.toolName !== 'task') return;
    if (!selected.size || (Array.isArray(event.input.tasks) && event.input.tasks.length > maxSubagents)) {
      return { block: true, reason: 'OMP delegation is disabled or exceeds the configured concurrency. Work inline or use a smaller batch.' };
    }
  });
}
