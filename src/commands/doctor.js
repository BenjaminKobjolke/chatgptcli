import { IS_COMPILED, runOpenCli } from '../core/opencli.js';
import { EXIT_CODE } from '../core/errors.js';

export function runDoctor(options) {
  if (IS_COMPILED) {
    process.stderr.write(
      'doctor needs an opencli checkout and is unavailable in the compiled exe; run `chatgptcli setup` for the bridge status.\n'
    );
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
