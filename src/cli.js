import { AppError, ERROR_CODE, EXIT_CODE, exitCodeForError, toAppError } from './core/errors.js';
import { runAsk } from './commands/ask.js';
import { runRead, runSwitch } from './commands/read.js';
import { runDoctor } from './commands/doctor.js';
import { runSetup } from './commands/setup.js';
import { runLaunch, runSetChrome, runSwitchSession } from './commands/chrome.js';
import { parseAskArgs, parseDoctorArgs, parseReadArgs, parseSetChromeArgs, parseSetupArgs, parseSwitchArgs } from './cli_args.js';
import { checkMinVersion } from './core/min_version.js';
import { IS_COMPILED } from './core/opencli.js';
import pkg from '../package.json';

const VERSION = pkg.version;

export async function runCli(argv) {
  const command = argv[0];

  if (!command || command === '-h' || command === '--help') {
    writeStdout(helpText());
    return EXIT_CODE.SUCCESS;
  }

  if (command === '-v' || command === '--version') {
    writeStdout(VERSION);
    return EXIT_CODE.SUCCESS;
  }

  try {
    // --help/--version above stay usable on a stale exe so the update flow can verify.
    const updateMessage = checkMinVersion(VERSION);
    if (updateMessage) {
      writeStderr(updateMessage);
      return EXIT_CODE.UPDATE_REQUIRED;
    }

    if (command === 'ask') {
      return emitResult(await runAsk(parseAskArgs(argv.slice(1))));
    }

    if (command === 'read') {
      return emitResult(await runRead(parseReadArgs(argv.slice(1))));
    }

    if (command === 'switch') {
      return emitResult(await runSwitch(parseSwitchArgs(argv.slice(1))));
    }

    if (command === 'doctor') {
      return runDoctor(parseDoctorArgs(argv.slice(1)));
    }

    if (command === 'setup') {
      return await runSetup(parseSetupArgs(argv.slice(1)));
    }

    if (command === 'set-chrome') {
      return runSetChrome(parseSetChromeArgs(argv.slice(1)));
    }

    if (command === 'switch-session') {
      if (argv.length > 2 || (argv[1] && argv[1].startsWith('-'))) {
        throw new AppError(ERROR_CODE.INPUT_INVALID, 'switch-session takes at most one argument.', {
          hint: 'Usage: chatgptcli switch-session [number|contextId|none]'
        });
      }
      return await runSwitchSession({ pick: argv[1] });
    }

    if (command === 'launch') {
      if (argv.length > 1) {
        throw new AppError(ERROR_CODE.INPUT_INVALID, `Unknown option: ${argv[1]}`, {
          hint: 'launch does not take options.'
        });
      }
      return runLaunch();
    }

    throw new AppError(ERROR_CODE.INPUT_INVALID, `Unknown command: ${command}`, {
      hint: 'Use --help to see supported commands.'
    });
  } catch (error) {
    const err = toAppError(error);
    writeStderr(`${err.code}: ${err.message}`);
    if (err.hint) {
      writeStderr(`Hint: ${err.hint}`);
    }
    return exitCodeForError(err);
  }
}

function helpText() {
  return [
    `chatgptcli v${VERSION}`,
    '',
    'Web-backed ChatGPT CLI via the local opencli Browser Bridge.',
    '',
    'Usage:',
    '  chatgptcli ask <prompt> [--new] [--file <path>] [--timeout <seconds>] [--max-attempts <n>] [--retry-delay-ms <ms>] [-f json|text]',
    '  chatgptcli read [chat-url-or-id] [--files-output <dir>] [--file-id <id>] [--files-inline] [-f json|text]',
    '  chatgptcli switch <chat-url-or-id>',
    // doctor spawns the opencli CLI, which a compiled exe does not carry.
    ...(IS_COMPILED ? [] : ['  chatgptcli doctor [--sessions] [--no-live]']),
    '  chatgptcli setup',
    '  chatgptcli set-chrome <path-to-chrome.exe> [--profile <dir>]',
    '  chatgptcli launch',
    '  chatgptcli switch-session [number|contextId|none]',
    '',
    'Notes:',
    '  ask always uses chatgpt.com web UI, not the OpenAI API.',
    '  ask reuses the site:chatgpt browser session and retries blocked or empty responses with a fresh chat fallback.',
    '  read shows attachments as [image-01]/[report-01] markers; --files-output <dir> downloads them, --files-inline prints report and file bodies instead.',
    '  setup validates local prerequisites and the Browser Bridge connection, and prints browser-extension/login guidance.',
    '  Requires the opencli Browser Bridge and a browser profile that has already logged into chatgpt.com at least once.'
  ].join('\n');
}

// `ask`, `read` and `switch` hand back `{ output, exitCode }` instead of printing themselves.
function emitResult(result) {
  writeStdout(result.output);
  return result.exitCode;
}

function writeStdout(message) {
  process.stdout.write(`${message}\n`);
}

function writeStderr(message) {
  process.stderr.write(`${message}\n`);
}
