export default function (pi) {
  pi.events.on('subagent:process-terminal', (event) => {
    if (event?.state === 'observed' && typeof event.runId === 'string') {
      console.error(`ORCA_TEST_TERMINAL ${event.runId}`);
    }
  });
}
