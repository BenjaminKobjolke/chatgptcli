import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AppError, ERROR_CODE } from './errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Compiled exes report a virtual bunfs path (B:/~BUN/... on Windows, /$bunfs/ on POSIX).
export const IS_COMPILED = typeof Bun !== 'undefined' && (Bun.main.includes('~BUN') || Bun.main.includes('$bunfs'));
export const OPENCLI_ENV = {
  ROOT: 'CHATGPTCLI_OPENCLI_ROOT',
  MAIN: 'CHATGPTCLI_OPENCLI_MAIN'
};

function defaultOpenCliRoot() {
  return resolve(__dirname, '..', '..', '.omx', 'reference', 'opencli');
}

function defaultMainPath(root) {
  return resolve(root, 'dist', 'src', 'main.js');
}

let execRunner = (cmd, args, options) => spawnSync(cmd, args, options);

export function __setExecRunnerForTest(runner) {
  execRunner = runner;
}

export function __resetExecRunnerForTest() {
  execRunner = (cmd, args, options) => spawnSync(cmd, args, options);
}

export function resolveOpenCliPaths() {
  const root = process.env[OPENCLI_ENV.ROOT] || defaultOpenCliRoot();
  const mainPath = process.env[OPENCLI_ENV.MAIN] || defaultMainPath(root);
  const extensionPath = resolve(root, 'extension');
  const browserIndexPath = resolve(root, 'dist', 'src', 'browser', 'index.js');
  return { root, mainPath, extensionPath, browserIndexPath };
}

function ensureOpenCliReady() {
  const { root, mainPath, browserIndexPath } = resolveOpenCliPaths();

  if (existsSync(mainPath) && existsSync(browserIndexPath)) {
    return { root, mainPath, browserIndexPath };
  }

  if (!existsSync(root)) {
    throw new AppError(ERROR_CODE.CONFIG_INVALID, `opencli reference repo not found: ${root}`, {
      hint: `Set ${OPENCLI_ENV.ROOT} or place opencli under .omx/reference/opencli.`
    });
  }

  const install = execRunner(process.execPath, ['install'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env }
  });

  if (install.error) {
    throw new AppError(ERROR_CODE.CONFIG_INVALID, 'Failed to bootstrap opencli.', {
      hint: 'Run bun install inside your opencli checkout.',
      details: install.error.message
    });
  }

  if (install.status !== 0 || !existsSync(mainPath) || !existsSync(browserIndexPath)) {
    throw new AppError(ERROR_CODE.CONFIG_INVALID, 'opencli bootstrap did not produce a runnable browser bridge.', {
      hint: 'Check opencli/dist/src/main.js and opencli/dist/src/browser/index.js.'
    });
  }

  return { root, mainPath, browserIndexPath };
}

export function runOpenCli(args) {
  const { mainPath } = ensureOpenCliReady();
  const result = execRunner(process.execPath, [mainPath, ...args], {
    stdio: 'inherit',
    env: { ...process.env }
  });

  if (result.error) {
    throw new AppError(ERROR_CODE.UNKNOWN, `Failed to execute opencli: ${result.error.message}`);
  }

  return result.status ?? 1;
}

export function captureOpenCli(args) {
  const { mainPath } = ensureOpenCliReady();
  const result = execRunner(process.execPath, [mainPath, ...args], {
    stdio: 'pipe',
    encoding: 'utf8',
    env: { ...process.env }
  });

  if (result.error) {
    throw new AppError(ERROR_CODE.UNKNOWN, `Failed to execute opencli: ${result.error.message}`);
  }

  return {
    status: result.status ?? 1,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : ''
  };
}

export async function loadBrowserBridge() {
  let mod;
  if (IS_COMPILED) {
    // Literal specifier so `bun build --compile` bundles the bridge and its deps into the exe.
    mod = await import('../../.omx/reference/opencli/dist/src/browser/index.js');
  } else {
    const { browserIndexPath } = ensureOpenCliReady();
    mod = await import(pathToFileURL(browserIndexPath).href);
  }

  if (typeof mod.BrowserBridge !== 'function') {
    throw new AppError(ERROR_CODE.CONFIG_INVALID, 'opencli BrowserBridge export is missing.', {
      hint: 'Check opencli/dist/src/browser/index.js.'
    });
  }

  return { BrowserBridge: mod.BrowserBridge, getDaemonHealth: mod.getDaemonHealth };
}

export async function connectBridge(bridge, opts) {
  try {
    return await bridge.connect(opts);
  } catch (error) {
    if (String(error?.message).includes('Multiple Browser Bridge profiles')) {
      throw new AppError(ERROR_CODE.CONFIG_INVALID, error.message, {
        hint: 'Run: chatgptcli switch-session'
      });
    }
    throw error;
  }
}
