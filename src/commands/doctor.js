import { IS_COMPILED, runOpenCli } from '../core/opencli.js';
import { EXIT_CODE } from '../core/errors.js';

export function runDoctor(options) {
  if (IS_COMPILED) {
    process.stderr.write('doctor is unavailable in the compiled exe; run `bun run src/main.js doctor` from the repo.\n');
    return EXIT_CODE.CONFIG;
  }

  const args = ['doctor'];

  if (options.sessions) {
    args.push('--sessions');
  }

  if (options.noLive) {
    args.push('--no-live');
  }

  return runOpenCli(args);
}
