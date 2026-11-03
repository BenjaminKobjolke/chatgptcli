import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { AppError, ERROR_CODE, EXIT_CODE } from '../core/errors.js';
import {
  runSetChrome as runSharedSetChrome,
  runSwitchSession as runSharedSwitchSession
} from '../../.omx/reference/opencli-app-kit/src/commands/chrome.js';
import { IS_COMPILED, resolveOpenCliPaths } from '../core/opencli.js';
import { CHATGPT_ROOT_URL } from '../core/chatgpt_site.js';
import { resolveChrome } from '../core/settings.js';
import { writeStdout } from '../../.omx/reference/opencli-app-kit/src/core/cli_shell.js';

const APP_NAME = 'chatgptcli';

export function runSetChrome(options) {
  return runSharedSetChrome({ ...options, appName: APP_NAME });
}

export function runLaunch() {
  const { executable, profileDir } = resolveChrome();

  if (!existsSync(executable)) {
    throw new AppError(ERROR_CODE.CONFIG_INVALID, `Chrome executable not found: ${executable}`, {
      hint: 'Set it with: chatgptcli set-chrome <path-to-chrome.exe>'
    });
  }

  mkdirSync(profileDir, { recursive: true });
  const args = [`--user-data-dir=${profileDir}`];
  const { extensionPath } = resolveOpenCliPaths();
  if (existsSync(extensionPath)) {
    args.push(`--load-extension=${extensionPath}`);
  } else if (!IS_COMPILED) {
    writeStdout('Note: opencli extension dir not found on disk; install the OpenCLI extension in Chrome manually.');
  }
  args.push(CHATGPT_ROOT_URL);

  spawn(executable, args, { detached: true, stdio: 'ignore' }).unref();
  writeStdout(
    `Launched ${executable} with profile ${profileDir}\n` +
      'Next: log into chatgpt.com in that window if asked, then run `chatgptcli setup` to check the Browser Bridge connection and extension.'
  );
  return EXIT_CODE.SUCCESS;
}

export function runSwitchSession(options) {
  return runSharedSwitchSession({ ...options, appName: APP_NAME });
}
