// Argument parsers for every CLI command. Split out of cli.js to keep files under the 300-line rule.
import { AppError, ERROR_CODE } from './core/errors.js';
import { normalizeChatUrl } from './commands/read.js';
import { buildPromptWithFile } from './core/prompt_file.js';

export function parseAskArgs(args) {
  const positional = [];
  let format = 'json';
  let timeoutSeconds = 120;
  let newChat = false;
  let maxAttempts = 5;
  let retryDelayMs = 1500;
  let filePath = null;

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (!token.startsWith('-')) {
      positional.push(token);
      continue;
    }

    if (token === '--new') {
      newChat = true;
      continue;
    }

    if (token === '--file') {
      filePath = requireValue(args, i, '--file');
      i += 1;
      continue;
    }

    if (token === '--timeout') {
      const raw = requireValue(args, i, '--timeout');
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) {
        throw new AppError(ERROR_CODE.INPUT_INVALID, 'Invalid --timeout value', {
          hint: 'Use a positive number of seconds.'
        });
      }
      timeoutSeconds = Math.floor(value);
      i += 1;
      continue;
    }

    if (token === '--max-attempts') {
      const raw = requireValue(args, i, '--max-attempts');
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) {
        throw new AppError(ERROR_CODE.INPUT_INVALID, 'Invalid --max-attempts value', {
          hint: 'Use a positive integer like 5.'
        });
      }
      maxAttempts = Math.floor(value);
      i += 1;
      continue;
    }

    if (token === '--retry-delay-ms') {
      const raw = requireValue(args, i, '--retry-delay-ms');
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) {
        throw new AppError(ERROR_CODE.INPUT_INVALID, 'Invalid --retry-delay-ms value', {
          hint: 'Use a non-negative integer like 1500.'
        });
      }
      retryDelayMs = Math.floor(value);
      i += 1;
      continue;
    }

    if (token === '-f' || token === '--format') {
      const next = requireValue(args, i, '--format');
      if (next !== 'json' && next !== 'text') {
        throw new AppError(ERROR_CODE.INPUT_INVALID, `Unsupported format: ${next}`, {
          hint: 'Supported formats: json, text.'
        });
      }
      format = next;
      i += 1;
      continue;
    }

    throw new AppError(ERROR_CODE.INPUT_INVALID, `Unknown option: ${token}`, {
      hint: 'Supported options: --new, --file, --timeout, --max-attempts, --retry-delay-ms, -f/--format.'
    });
  }

  let prompt = positional.join(' ').trim();
  if (!prompt) {
    throw new AppError(ERROR_CODE.INPUT_INVALID, 'Missing prompt', {
      hint: 'Usage: chatgptcli ask "your prompt"'
    });
  }

  if (filePath) {
    prompt = buildPromptWithFile(prompt, filePath);
  }

  return { prompt, format, timeoutSeconds, newChat, maxAttempts, retryDelayMs };
}

export function parseReadArgs(args) {
  let format = 'json';
  let filesOutputDir = null;
  let fileId = null;
  let filesInline = false;
  const positional = [];

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (!token.startsWith('-')) {
      positional.push(token);
      continue;
    }

    if (token === '--files-output') {
      filesOutputDir = requireValue(args, i, '--files-output');
      i += 1;
      continue;
    }

    if (token === '--file-id') {
      fileId = requireValue(args, i, '--file-id');
      i += 1;
      continue;
    }

    if (token === '--files-inline') {
      filesInline = true;
      continue;
    }

    if (token === '-f' || token === '--format') {
      const next = requireValue(args, i, '--format');
      if (next !== 'json' && next !== 'text') {
        throw new AppError(ERROR_CODE.INPUT_INVALID, `Unsupported format: ${next}`, {
          hint: 'Supported formats: json, text.'
        });
      }
      format = next;
      i += 1;
      continue;
    }

    throw new AppError(ERROR_CODE.INPUT_INVALID, `Unknown option: ${token}`, {
      hint: 'Supported options: -f/--format, --files-output, --file-id, --files-inline.'
    });
  }

  if (positional.length > 1) {
    throw new AppError(ERROR_CODE.INPUT_INVALID, 'read takes at most one chat URL or id.');
  }

  if (fileId && !filesOutputDir) {
    throw new AppError(ERROR_CODE.INPUT_INVALID, '--file-id needs a download target.', {
      hint: 'Use --files-output <dir> together with --file-id.'
    });
  }

  return { format, url: normalizeChatUrl(positional[0]), filesOutputDir, fileId, filesInline };
}

export function parseSwitchArgs(args) {
  if (args.length !== 1 || args[0].startsWith('-')) {
    throw new AppError(ERROR_CODE.INPUT_INVALID, 'switch requires exactly one chat URL or id.', {
      hint: 'Usage: chatgptcli switch https://chatgpt.com/c/<id>'
    });
  }

  return { url: normalizeChatUrl(args[0]) };
}

export function parseDoctorArgs(args) {
  let sessions = false;
  let noLive = false;

  for (const token of args) {
    if (token === '--sessions') {
      sessions = true;
      continue;
    }

    if (token === '--no-live') {
      noLive = true;
      continue;
    }

    throw new AppError(ERROR_CODE.INPUT_INVALID, `Unknown option: ${token}`, {
      hint: 'Supported options: --sessions, --no-live.'
    });
  }

  return { sessions, noLive };
}

export function parseSetupArgs(args) {
  if (args.length > 0) {
    throw new AppError(ERROR_CODE.INPUT_INVALID, `Unknown option: ${args[0]}`, {
      hint: 'setup does not take options.'
    });
  }

  return {};
}

export function parseSetChromeArgs(args) {
  let executable;
  let profileDir;

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--profile') {
      profileDir = requireValue(args, i, '--profile');
      i += 1;
      continue;
    }

    if (token.startsWith('-')) {
      throw new AppError(ERROR_CODE.INPUT_INVALID, `Unknown option: ${token}`, {
        hint: 'Supported options: --profile <dir>.'
      });
    }

    if (executable) {
      throw new AppError(ERROR_CODE.INPUT_INVALID, 'set-chrome takes at most one executable path.');
    }
    executable = token;
  }

  if (!executable && !profileDir) {
    throw new AppError(ERROR_CODE.INPUT_INVALID, 'Nothing to set.', {
      hint: 'Usage: chatgptcli set-chrome <path-to-chrome.exe> [--profile <dir>]'
    });
  }

  return { executable, profileDir };
}

function requireValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new AppError(ERROR_CODE.INPUT_INVALID, `Missing value for ${flag}`, {
      hint: `Provide a value after ${flag}.`
    });
  }
  return value;
}
