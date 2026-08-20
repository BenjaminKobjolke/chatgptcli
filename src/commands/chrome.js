import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { AppError, ERROR_CODE, EXIT_CODE } from '../core/errors.js';
import { loadBrowserBridge, resolveOpenCliPaths } from '../core/opencli.js';
import {
  loadSettings,
  resolveBridgeProfile,
  resolveChrome,
  saveSettings,
  settingsPath
} from '../core/settings.js';

export function runSetChrome({ executable, profileDir }) {
  if (executable && !existsSync(executable)) {
    throw new AppError(ERROR_CODE.INPUT_INVALID, `Chrome executable not found: ${executable}`);
  }

  const chrome = { ...(loadSettings().chrome ?? {}) };
  if (executable) {
    chrome.executable = executable;
  }
  if (profileDir) {
    chrome.profileDir = profileDir;
  }
  saveSettings({ chrome });

  const resolved = resolveChrome();
  process.stdout.write(
    [
      `Saved ${settingsPath()}`,
      `Chrome executable: ${resolved.executable}`,
      `Profile dir: ${resolved.profileDir}`
    ].join('\n') + '\n'
  );
  return EXIT_CODE.SUCCESS;
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
  } else {
    process.stdout.write(
      'Note: opencli extension dir not found on disk; install the OpenCLI extension in Chrome manually.\n'
    );
  }
  args.push('https://chatgpt.com/');

  spawn(executable, args, { detached: true, stdio: 'ignore' }).unref();
  process.stdout.write(`Launched ${executable} with profile ${profileDir}\n`);
  return EXIT_CODE.SUCCESS;
}

function saveBridgeProfile(contextId) {
  const chrome = { ...(loadSettings().chrome ?? {}) };
  if (contextId) {
    chrome.bridgeProfile = contextId;
  } else {
    delete chrome.bridgeProfile;
  }
  saveSettings({ chrome });
}

export async function runSwitchSession({ pick } = {}) {
  if (pick === 'none') {
    saveBridgeProfile(undefined);
    process.stdout.write('Bridge profile cleared; daemon will auto-pick when only one is connected.\n');
    return EXIT_CODE.SUCCESS;
  }

  const { getDaemonHealth } = await loadBrowserBridge();
  if (typeof getDaemonHealth !== 'function') {
    throw new AppError(ERROR_CODE.CONFIG_INVALID, 'This opencli build does not export getDaemonHealth.', {
      hint: 'Update the opencli checkout and rebuild.'
    });
  }

  const health = await getDaemonHealth();
  if (health.state === 'stopped' || !health.status) {
    throw new AppError(ERROR_CODE.CONFIG_INVALID, 'Bridge daemon is not running.', {
      hint: 'Start Chrome with: chatgptcli launch (then retry).'
    });
  }

  const profiles = Array.isArray(health.status.profiles) ? health.status.profiles : [];
  if (profiles.length === 0) {
    throw new AppError(ERROR_CODE.CONFIG_INVALID, 'No Browser Bridge profiles connected.', {
      hint: 'Open a Chrome profile with the OpenCLI extension enabled, e.g. via chatgptcli launch.'
    });
  }

  const current = resolveBridgeProfile();
  const lines = profiles.map((profile, index) => {
    const version = profile.extensionVersion ? ` v${profile.extensionVersion}` : '';
    const mark = profile.contextId === current ? ' (current)' : '';
    return `  [${index + 1}] ${profile.contextId}${version}${mark}`;
  });
  process.stdout.write(`Connected Browser Bridge profiles:\n${lines.join('\n')}\n`);

  let chosen;
  if (pick) {
    const byNumber = Number(pick);
    if (Number.isInteger(byNumber) && byNumber >= 1 && byNumber <= profiles.length) {
      chosen = profiles[byNumber - 1].contextId;
    } else if (profiles.some((profile) => profile.contextId === pick)) {
      chosen = pick;
    } else {
      throw new AppError(ERROR_CODE.INPUT_INVALID, `No such profile: ${pick}`, {
        hint: `Use a number 1-${profiles.length}, a listed contextId, or "none".`
      });
    }
  } else if (profiles.length === 1) {
    chosen = profiles[0].contextId;
    process.stdout.write('Only one profile connected; selecting it.\n');
  } else {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = (await rl.question(`Select profile [1-${profiles.length}]: `)).trim();
      const index = Number(answer);
      if (!Number.isInteger(index) || index < 1 || index > profiles.length) {
        throw new AppError(ERROR_CODE.INPUT_INVALID, `Invalid selection: ${answer}`);
      }
      chosen = profiles[index - 1].contextId;
    } finally {
      rl.close();
    }
  }

  saveBridgeProfile(chosen);
  process.stdout.write(`Saved bridge profile "${chosen}" to ${settingsPath()}\n`);
  return EXIT_CODE.SUCCESS;
}
