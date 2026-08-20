#!/usr/bin/env bun
const firstArg = process.argv[2];

if (firstArg && firstArg.includes('~BUN') && firstArg.endsWith('daemon.js')) {
  // Compiled exe: the bundled bridge spawns the daemon as `<exe> <bunfs-path>/daemon.js`.
  // Run the bundled daemon in-process instead of treating it as a CLI command.
  await import('../.omx/reference/opencli/dist/src/daemon.js');
} else {
  const { runCli } = await import('./cli.js');
  const exitCode = await runCli(process.argv.slice(2));
  process.exit(exitCode);
}
