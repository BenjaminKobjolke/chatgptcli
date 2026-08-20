// Exe self-update check: the Claude plugin ships a min_exe_version.txt; on
// every CLI start the exe compares its own version against it and reports
// UPDATE_REQUIRED so the calling agent can re-download a stale exe.
// Fail-open by design: no file found (direct CLI users without the plugin,
// unreadable file, garbage content) means no check.
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MIN_VERSION_FILE_NAME = 'min_exe_version.txt';
const MIN_VERSION_ENV_VAR = 'CHATGPTCLI_MIN_VERSION_FILE';
const PLUGIN_ROOT_ENV_VAR = 'CLAUDE_PLUGIN_ROOT';
const CONFIG_DIR_ENV_VAR = 'CLAUDE_CONFIG_DIR';
const SKILL_RELATIVE_DIR = ['skills', 'chatgptcli'];
const PLUGIN_CACHE_RELATIVE_DIR = ['plugins', 'cache', 'chatgptcli', 'chatgptcli'];
const DOWNLOAD_URL = 'https://github.com/BenjaminKobjolke/chatgptcli/releases/latest/download/chatgptcli.exe';
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

function compareSemver(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) {
      return left[i] < right[i] ? -1 : 1;
    }
  }
  return 0;
}

function readVersionFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8').trim();
    return SEMVER_PATTERN.test(content) ? content : null;
  } catch {
    return null;
  }
}

function readSkillMinVersion(baseDir) {
  return readVersionFile(join(baseDir, ...SKILL_RELATIVE_DIR, MIN_VERSION_FILE_NAME));
}

// Every install scope (user/project/local) stores plugin files in the same
// shared cache under version-suffixed dirs; leftover orphaned dirs may
// coexist, so take the highest min version found across all of them.
function scanPluginCache() {
  const configDir = process.env[CONFIG_DIR_ENV_VAR] || join(homedir(), '.claude');
  const cacheDir = join(configDir, ...PLUGIN_CACHE_RELATIVE_DIR);

  let entries;
  try {
    entries = readdirSync(cacheDir);
  } catch {
    return null;
  }

  let highest = null;
  for (const entry of entries) {
    const version = readSkillMinVersion(join(cacheDir, entry));
    if (version && (!highest || compareSemver(version, highest) > 0)) {
      highest = version;
    }
  }
  return highest;
}

function findRequiredMinVersion() {
  const overrideFile = process.env[MIN_VERSION_ENV_VAR];
  if (overrideFile) {
    // Override is authoritative (tests + escape hatch) — no fallback.
    return readVersionFile(overrideFile);
  }

  const pluginRoot = process.env[PLUGIN_ROOT_ENV_VAR];
  if (pluginRoot) {
    const version = readSkillMinVersion(pluginRoot);
    if (version) {
      return version;
    }
  }

  return scanPluginCache();
}

export function checkMinVersion(currentVersion) {
  const minVersion = findRequiredMinVersion();
  if (!minVersion || compareSemver(currentVersion, minVersion) >= 0) {
    return null;
  }

  return [
    `UPDATE_REQUIRED: chatgptcli.exe ${currentVersion} is older than required ${minVersion}`,
    'Update it:',
    '  taskkill /im chatgptcli.exe /f',
    `  powershell -Command "Invoke-WebRequest '${DOWNLOAD_URL}' -OutFile \\"$HOME\\.chatgptcli\\bin\\chatgptcli.exe\\""`,
    'Then retry the original command.'
  ].join('\n');
}

export const __test__ = { compareSemver };
