import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { AppError, ERROR_CODE } from './errors.js';

export function settingsPath() {
  return join(homedir(), '.chatgptcli', 'settings.json');
}

export function loadSettings() {
  const path = settingsPath();
  if (!existsSync(path)) {
    return {};
  }

  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    throw new AppError(ERROR_CODE.CONFIG_INVALID, `Cannot read settings: ${path}`, {
      details: error.message
    });
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    throw new AppError(ERROR_CODE.CONFIG_INVALID, `Invalid JSON in settings: ${path}`, {
      hint: 'Fix or delete the file, then rerun set-chrome.'
    });
  }
}

export function saveSettings(partial) {
  const path = settingsPath();
  const merged = { ...loadSettings(), ...partial };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  return merged;
}

function defaultChromeExecutable() {
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  if (process.platform === 'win32') {
    return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  }
  return '/usr/bin/google-chrome';
}

export function resolveBridgeProfile() {
  return loadSettings().chrome?.bridgeProfile || undefined;
}

export function resolveChrome() {
  const chrome = loadSettings().chrome ?? {};
  return {
    executable: chrome.executable || defaultChromeExecutable(),
    profileDir: chrome.profileDir || join(homedir(), '.chatgptcli', 'chrome-profile')
  };
}
